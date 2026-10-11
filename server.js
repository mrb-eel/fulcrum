import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, relative, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchLiveCaseInputs } from "./providers.js";
import { createLiveEvidenceSnapshot } from "./live-evidence-snapshot.js";
import { buildPositionSnapshot } from "./position.js";
import { analyzePacket } from "./analysis.js";
import { loadLatestSavedSnapshot } from "./snapshot-store.js";
import { fromCasePacket } from "./case-adapter.js";
import { discoverMorpho, validateDiscovery } from "./position-discovery.js";
import { evaluatePortfolio, buildInvestigation, buildTimeline, evidenceGaps, rehearseExit } from "./portfolio-engine.js";
import { loadSavedVault, discoverVault, verifyVaultPacket } from './vault-discovery.js';
import { captureEnrichment, verifySealed } from './enrichment.js';
import { analyseLending } from './lending-scan.js';
import { buildVaultModel, evaluateVault, reverseVaultStress } from './vault-engine.js';
import { loadBook, evaluateBook, sharedDependencies } from './book-engine.js';

const directory = fileURLToPath(new URL(".", import.meta.url));
const publicDirectory = join(directory, "..", "public");
const engineFiles = new Set(["analysis.js", "risk-engine.js", "decision-engine.js", "math.js", "portfolio-engine.js", "case-adapter.js"]);
const types = { ".woff2": "font/woff2", ".css": "text/css", ".html": "text/html", ".js": "text/javascript", ".svg": "image/svg+xml", ".md": "text/plain", ".json": "application/json" };

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

function readJson(request) {
  return new Promise((resolve,reject)=>{
    let size=0,oversized=false,chunks=[];
    request.on("data",chunk=>{size+=chunk.length;if(size>5_000_000){oversized=true;chunks=[];}else if(!oversized)chunks.push(chunk);});
    request.on("error",reject);
    request.on("end",()=>{
      if(oversized)return reject(Object.assign(new Error("Portfolio input exceeds 5 MB."),{status:413}));
      try{resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));}
      catch{reject(Object.assign(new Error("Body must be JSON."),{status:400}));}
    });
  });
}

function parameters(url) {
  const result = {};
  for (const key of ["underlyingHaircut", "exitDiscount", "lossLimit", "eventProbability", "oracleTransmission"]) {
    if (url.searchParams.has(key)) {
      const value = url.searchParams.get(key);
      if (value.trim() === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1) {
        const error = new Error(`${key} must be between zero and one.`);
        error.status = 400;
        throw error;
      }
      result[key] = Number(value);
    }
  }
  if (url.searchParams.has("oracleMode")) {
    const mode = url.searchParams.get("oracleMode");
    if (!["observed-current-primary", "backup-after-timelock", "custom-counterfactual"].includes(mode)) {
      const error = new Error("Unknown oracle mode."); error.status = 400; throw error;
    }
    result.oracleMode = mode;
  }
  return result;
}

export function createAppServer({ liveLoader = fetchLiveCaseInputs, savedLoader = loadLatestSavedSnapshot, discoveryLoader = discoverMorpho, vaultLoader = null, bookLoader = loadBook } = {}) {
  let liveRead = null;
  let savedRead = null;
  let vaultRead = null;
  let bookRead = null;
  const book = () => bookRead ??= bookLoader().catch(error=>{bookRead=null;throw error;});
  // A pocket of the book by id; an injected vaultLoader (tests, single-vault mode) serves the default.
  let lendingRead = null;
  const lending = () => lendingRead ??= readFile(new URL('../data/book/lending.json', import.meta.url), 'utf8').then(t => analyseLending(verifySealed(JSON.parse(t), 'lending'))).catch(error => { lendingRead = null; throw error; });
  const custom = new Map();
  // Any Morpho V1 vault: captured live by address, or imported as a saved evidence packet.
  async function addCustom(packet, live) {
    verifyVaultPacket(packet);
    let enrichment = null;
    try { enrichment = await captureEnrichment([packet]); } catch (error) { if (live) throw error; }
    const history = (await book().catch(() => null))?.history ?? null;
    const id = `custom-${packet.snapshot.address.toLowerCase()}`;
    custom.set(id, { id, packet, model: buildVaultModel(packet, { enrichment, history }), note: live ? 'Captured live' : 'Imported packet' });
    return { id, name: packet.snapshot.vault.name, oracleReads: !!enrichment };
  }
  async function vault(id) {
    if (id && custom.has(id)) return custom.get(id);
    if (vaultLoader && !id) return vaultRead ??= vaultLoader().then(packet => ({packet, model:buildVaultModel(packet), id:'default'})).catch(error=>{vaultRead=null;throw error;});
    const b = await book(), pocket = id ? b.pockets.find(p => p.id === id) : b.pockets[0];
    if (!pocket) throw Object.assign(new Error('Unknown vault id.'), {status:404});
    return pocket;
  }
  function vaultReport(model, options={}) {
    const {id,...rest}=options;
    const defaults=model.dependencies.some(d=>d.id==='family:BTC')?{incident:'price-fall',targetId:'family:BTC'}:{incident:'collateral-decline',targetId:'all'};
    const settings={positionUsd:Math.min(1_000_000,model.total*model.usdPrice),...defaults,...rest};
    const result=evaluateVault(model,settings);
    const {markets,graph,history,...summary}=model;
    const shockable=['collateral-decline','price-fall','depeg','feed-freeze'].includes(result.settings.incident);
    return {model:{...summary,markets:markets.map(({borrowers,...m})=>({...m,borrowerCount:borrowers.length})),
      dependencies:summary.dependencies.filter(d=>d.kind!=='borrower'||d.marketIds.length>1)},result,
      reverse:shockable?reverseVaultStress(model,settings):null,
      curve:shockable?[0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1].map(shock=>({shock,loss:evaluateVault(model,{...settings,collateralShock:shock}).incidentUsd})):[]};
  }
  async function bookReport(options={}) {
    const b=await book();
    const settings={incident:'price-fall',targetId:'family:BTC',collateralShock:.35,path:'gap',recoveryDiscount:.05,horizonDays:30,...options};
    return {settings,pockets:b.pockets.map(p=>({id:p.id,name:p.model.name,address:p.model.address,asset:p.model.asset.symbol,note:p.note,tvlUsd:p.model.total*p.model.usdPrice,
      netApy:p.model.netApy,markets:p.model.markets.length,borrowers:p.model.borrowerCount,capturedAt:p.model.capturedAt,snapshotId:p.model.snapshotId,
      blind:p.model.dependencies.filter(d=>d.kind==='blindspot').map(d=>({label:d.label,share:d.exposure/p.model.total,reason:d.reason}))})),
      shared:sharedDependencies(b.pockets),evaluation:evaluateBook(b,settings),
      evidence:{enrichmentId:b.enrichment.snapshotId,block:b.enrichment.snapshot.block,historyId:b.history.snapshotId,capturedAt:b.enrichment.snapshot.capturedAt}};
  }
  const discoveries = new Map();
  const saved = () => savedRead ??= savedLoader().catch((error) => { savedRead = null; throw error; });
  // Concurrent refresh clicks share one capture; calculation sliders never fetch providers.
  const live = () => liveRead ??= (async () => {
    const inputs = await liveLoader();
    return { ...createLiveEvidenceSnapshot(inputs, new Date().toISOString()), fileName: null };
  })().finally(() => { liveRead = null; });

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");
      if(request.method==='POST'&&url.pathname==='/api/vault/evaluate') {
        const body=await readJson(request);
        const v=await vault(body.id);
        try{return sendJson(response,200,vaultReport(v.model,body));}
        catch(error){error.status??=400;throw error;}
      }
      if(request.method==='POST'&&url.pathname==='/api/vault/capture') {
        const body=await readJson(request);
        if(!/^0x[\da-f]{40}$/i.test(body.address??''))return sendJson(response,400,{error:'Paste a vault contract address (0x followed by 40 hex characters).'});
        try{return sendJson(response,200,await addCustom(await discoverVault(body.address,Number(body.chainId??1)),true));}
        catch(error){error.status??=502;throw error;}
      }
      if(request.method==='POST'&&url.pathname==='/api/vault/import') {
        const body=await readJson(request);
        try{return sendJson(response,200,await addCustom(body,false));}
        catch(error){error.status??=400;throw error;}
      }
      if(request.method==='POST'&&url.pathname==='/api/book/evaluate') {
        const body=await readJson(request);
        try{return sendJson(response,200,await bookReport(body));}
        catch(error){error.status??=400;throw error;}
      }
      if (request.method === "POST" && url.pathname === "/api/evaluate") {
        const body=await readJson(request);
        try {
          const portfolio=body.portfolio??body, scenario=body.scenario??{};
          const analysis=evaluatePortfolio(portfolio,scenario);
          const reports=portfolio.positions.map((p,i)=>analysis.rows[i].status!=="modelled"?{positionId:p.id,result:analysis.rows[i]}:{positionId:p.id,result:analysis.rows[i],investigation:buildInvestigation(p),timeline:buildTimeline(p,scenario),gaps:evidenceGaps(p,analysis.rows[i]),exitRehearsal:rehearseExit(p,body.exitSettings??{})});
          return sendJson(response,200,{...analysis,scenario,reports});
        } catch(error) {error.status=400;throw error;}
      }
      if (request.method !== "GET") return sendJson(response, 405, { error: "Use GET for this read-only server." });
      if (url.pathname === "/api/health") return sendJson(response, 200, { status: "ok" });
      const vid=url.searchParams.get('id')||undefined;
      if(url.pathname==='/api/book') return sendJson(response,200,await bookReport());
      if(url.pathname==='/api/lending') return sendJson(response,200,await lending());
      if(url.pathname==='/api/book/enrichment') return sendJson(response,200,(await book()).enrichment);
      if(url.pathname==='/api/book/history') return sendJson(response,200,(await book()).history);
      if(url.pathname==='/api/vault') return sendJson(response,200,vaultReport((await vault(vid)).model));
      if(url.pathname==='/api/vault/evidence') return sendJson(response,200,(await vault(vid)).packet);
      if(url.pathname==='/api/vault/graph') return sendJson(response,200,(await vault(vid)).model.graph);
      if (url.pathname.startsWith("/api/")) {
        const options = parameters(url);
        if (url.pathname === "/api/portfolio") return sendJson(response, 200, fromCasePacket(await saved()));
        if (url.pathname === "/api/discover") {
          const address = url.searchParams.get("address"), chain = Number(url.searchParams.get("chainId"));
          validateDiscovery(address, chain);
          const key = `${chain}:${address.toLowerCase()}`;
          let cached = discoveries.get(key);
          if (!cached || Date.now() >= cached.expires) {
            if (discoveries.size >= 64) discoveries.delete(discoveries.keys().next().value);
            cached = { expires: Date.now() + 30_000, promise: discoveryLoader(address, chain).catch(error => { discoveries.delete(key); throw error; }) };
            discoveries.set(key, cached);
          }
          return sendJson(response, 200, await cached.promise);
        }
        if (url.pathname === "/api/demo-analysis") {
          const packet = await saved();
          return sendJson(response, 200, { packet, ...analyzePacket(packet, options), dataMode: "saved" });
        }
        if (url.pathname === "/api/live-analysis") {
          const packet = await live();
          return sendJson(response, 200, { packet, ...analyzePacket(packet, options), dataMode: "live" });
        }
        if (url.pathname === "/api/evidence-snapshot") return sendJson(response, 200, await live());
        if (url.pathname === "/api/position") {
          const packet = await live();
          return sendJson(response, 200, buildPositionSnapshot(packet.snapshot.rawInputs, packet.snapshot.observedAt));
        }
        const field = { "/api/risk-simulation": "scenario", "/api/critical-shock": "critical", "/api/decision-frontier": "decision" }[url.pathname];
        if (field) return sendJson(response, 200, analyzePacket(await live(), options)[field]);
        return sendJson(response, 404, { error: "Unknown API endpoint." });
      }
      let file;
      if (url.pathname.startsWith("/engine/")) {
        const name = url.pathname.slice(8);
        if (!engineFiles.has(name)) return sendJson(response, 404, { error: "Not found." });
        file = join(directory, name);
      } else {
        const requested = url.pathname === "/" ? "start.html" : url.pathname === '/portfolio.html' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
        file = join(publicDirectory, requested);
        const subpath = relative(publicDirectory, file);
        if (subpath.startsWith("..") || isAbsolute(subpath)) return sendJson(response, 403, { error: "Forbidden." });
      }
      const content = await readFile(file);
      response.writeHead(200, { "content-type": `${types[extname(file)] ?? "application/octet-stream"}; charset=utf-8`, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      response.end(content);
    } catch (error) {
      const denied = ["EACCES", "EPERM"].includes(error.code) || ["EACCES", "EPERM"].includes(error.cause?.code);
      const status = error.status ?? (error.code === "ENOENT" ? 404 : 503);
      sendJson(response, status, {
        error: denied ? "Live data is unavailable because this server cannot reach the public APIs." : "This read could not be completed.",
        code: denied ? "NETWORK_ACCESS_BLOCKED" : error.code ?? "READ_UNAVAILABLE",
        provider: error.provider ?? null,
        detail: error.message,
        retainedData: true
      });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 4173);
  // Locally only this machine can connect; on a host (PORT is set) accept outside connections.
  const host = process.env.PORT ? "0.0.0.0" : "127.0.0.1";
  createAppServer().listen(port, host, () => console.log(`FULCRUM is running at http://localhost:${port}`));
}
