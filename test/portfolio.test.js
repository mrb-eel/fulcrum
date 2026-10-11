import test from "node:test";
import assert from "node:assert/strict";
import {SCHEMA,evaluatePosition,evaluatePortfolio,validatePortfolio,rehearseExit,buildTimeline,evidenceGaps} from "../src/portfolio-engine.js";
import {fromCasePacket,comparisonExamples} from "../src/case-adapter.js";
import {loadLatestSavedSnapshot} from "../src/snapshot-store.js";
import {analyzePacket} from "../src/analysis.js";
import {discoverMorpho,normalizeMorphoRow} from "../src/position-discovery.js";
import {createAppServer} from "../src/server.js";

const packet=await loadLatestSavedSnapshot(),portfolio=fromCasePacket(packet),p=portfolio.positions[0];
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);

test("general model agrees with the recorded case without token-specific math",()=>{
  const general=evaluatePosition(p),original=analyzePacket(packet).scenario;
  assert.equal(Number(general.lossUsd.toFixed(2)),original.result.equityLossUsd);
  close(general.health,original.result.healthFactor);
  close(general.lossFraction,original.result.equityLossFraction);
  assert.equal(general.status,"modelled");
});

test("attribution conserves total loss across combined shocks",()=>{
  for(let i=0;i<40;i++){
    const r=evaluatePosition(p,{underlyingDrop:i/100,exitDiscount:(40-i)/100,debtRise:i/500});
    close(Object.values(r.attribution).reduce((a,b)=>a+b,0),r.lossUsd);
  }
});

test("continuous reverse stress inverts the model and the minimax threshold",()=>{
  for(const lossLimit of [.01,.1,.5,1]){
    const r=evaluatePosition(p,{lossLimit,underlyingDrop:0});
    close(evaluatePosition(p,{lossLimit,underlyingDrop:0,exitDiscount:r.exitBoundary}).lossFraction,lossLimit);
    close(evaluatePosition(p,{underlyingDrop:r.jointThreshold,exitDiscount:r.jointThreshold}).lossFraction,lossLimit);
    assert.ok(evaluatePosition(p,{underlyingDrop:r.jointThreshold*.99,exitDiscount:r.jointThreshold*.99}).lossFraction<lossLimit);
  }
});

test("unknown oracle does not inherit the case's fixed response",()=>{
  const next=structuredClone(p);next.oracle={mode:"unknown",evidenceIds:[]};
  const r=evaluatePosition(next,{underlyingDrop:.1,exitDiscount:.05});
  assert.equal(r.health,null);assert.ok(r.healthRange[0]<r.healthRange[1]);
  assert.equal(r.liquidation,"unknown");
  assert.ok(evidenceGaps(next,r).some(g=>g.title.includes("Oracle")));
});

test("repricing loan currency changes economic equity, not a fixed native health ratio",()=>{
  const base=evaluatePosition(p),shocked=evaluatePosition(p,{debtRise:.1});
  close(shocked.health,base.health);assert.ok(shocked.lossUsd>base.lossUsd);
  const usdFeed=structuredClone(p);usdFeed.oracle.denomination="usd";
  close(evaluatePosition(usdFeed,{debtRise:.1}).health,base.health/1.1);
});

test("unsupported, invalid and insolvent positions remain explicit",()=>{
  const bad={...structuredClone(p),id:"missing-price"};bad.assets[0].valueUsd=null;
  const nonlinear={...p,id:"lp",kind:"concentrated-liquidity"};
  const insolvent=structuredClone(p);insolvent.id="insolvent";insolvent.assets[1].valueUsd=5e6;
  const r=evaluatePortfolio({schemaVersion:SCHEMA,positions:[p,bad,nonlinear,insolvent]});
  assert.equal(r.rows.length,4);assert.equal(r.rows[1].status,"blocked");assert.equal(r.rows[2].status,"unsupported");
  assert.equal(r.rows[3].lossFraction,null);assert.equal(r.rows[3].jointThreshold,null);assert.equal(r.partial,true);
  assert.equal(r.actualEvaluated,2);
});

test("examples never enter totals and duplicate positions are rejected",()=>{
  const r=evaluatePortfolio({...portfolio,positions:[p,...comparisonExamples()]});
  close(r.totals.equityUsd,evaluatePosition(p).equityUsd);assert.equal(r.evaluated,3);assert.equal(r.actualCount,1);
  assert.throws(()=>validatePortfolio({...portfolio,positions:[p,p]}),/Duplicate/);
});

test("shared dependency targeting affects only matching value legs",()=>{
  const second=structuredClone(p);second.id="second";
  const third=structuredClone(p);third.id="third";third.dependencies=third.dependencies.filter(d=>d.id!=="protocol:ethena");
  const r=evaluatePortfolio({...portfolio,positions:[p,second,third]},{dependencyId:"protocol:ethena",underlyingDrop:.1,exitDiscount:0});
  close(r.rows[0].lossUsd,r.rows[1].lossUsd);assert.equal(r.rows[2].lossUsd,0);
  assert.equal(r.shared.find(d=>d.id==="protocol:ethena").positionIds.length,2);
  const control=evaluatePosition(p,{dependencyId:"chain:1",underlyingDrop:.5,exitDiscount:0});
  assert.equal(control.lossUsd,0);
});

test("exit rehearsal detects circular funding and cannot claim execution",()=>{
  const blocked=rehearseExit(p);assert.ok(blocked.fundingShortfallUsd>850000);assert.equal(blocked.status,"blocked");
  const funded=rehearseExit(p,{cashUsd:1e6,gasUsd:100,fundingFeeUsd:500});
  assert.equal(funded.status,"arithmetic-only");assert.ok(funded.remainingHealth>=1.05);
  close(funded.netAfterEnteredCostsUsd,funded.proceedsUsd-funded.repaymentUsd-600);
  assert.equal(rehearseExit(p,{cashUsd:1e6,fraction:.4}).proceedsUsd,null);
  assert.equal(rehearseExit(p,{cashUsd:1e6,atomic:true}).status,"blocked");
});

test("backup sequence requires explicit assumed activation and a separate price shock",()=>{
  assert.equal(buildTimeline(p).at(-1).result,null);
  const stages=buildTimeline(p,{assumeBackup:true,backupDrop:.1});
  close(stages.at(-1).result.health,evaluatePosition(p).baselineHealth*.9);
  close(stages[2].result.health,evaluatePosition(p).baselineHealth);
});

const wallet="0x"+"a".repeat(40),market="0x"+"1".repeat(64),oracle="0x"+"2".repeat(40);
const row={user:{address:wallet},market:{marketId:market,lltv:"800000000000000000",oracle:{address:oracle},loanAsset:{address:"0x"+"3".repeat(40),symbol:"USDC",decimals:6},collateralAsset:{address:"0x"+"4".repeat(40),symbol:"BTC",decimals:8}},state:{collateral:"200000000",collateralUsd:100000,borrowAssets:"60000000000",borrowAssetsUsd:60000,supplyAssets:"10000000000",supplyAssetsUsd:10000}};

test("Morpho normalization handles different decimals and separate supply accounting",()=>{
  const rows=normalizeMorphoRow(row,{chainId:1,observedAt:p.observedAt,address:wallet,oracleState:{price:(50000n*10n**34n).toString()}});
  assert.equal(rows.length,2);assert.equal(rows[0].assets[0].oracleValueUsd,100000);
  const r=evaluatePortfolio({schemaVersion:SCHEMA,positions:rows});
  assert.equal(r.totals.assetsUsd,110000);assert.equal(r.totals.debtUsd,60000);
  close(r.rows[0].baselineHealth,4/3);assert.equal(r.rows[0].health,null);
});

test("discovery paginates, deduplicates and exposes incomplete scope",async()=>{
  let pages=0;
  const request=async(url)=>url.endsWith("/graphql")?{data:{marketPositions:{items:pages++===0?[row]:[]}}}:{data:{price:(50000n*10n**34n).toString()}};
  const found=await discoverMorpho(wallet,1,{request,pageSize:1});
  assert.equal(found.positions.length,2);assert.equal(found.scope.complete,true);assert.equal(pages,2);
  const capped=await discoverMorpho(wallet,1,{request:async(url)=>url.endsWith("/graphql")?{data:{marketPositions:{items:[row]}}}:{data:{}},pageSize:1,maxPages:1});
  assert.equal(capped.scope.complete,false);assert.ok(capped.scope.warnings.length);
  const repeated=await discoverMorpho(wallet,1,{request:async(url)=>url.endsWith("/graphql")?{data:{marketPositions:{items:[row]}}}:{data:{}},pageSize:1,maxPages:3});
  assert.equal(repeated.positions.length,2);assert.equal(repeated.scope.complete,false);
});

test("discovery refuses wrong wallets and retains positions when oracle enrichment fails",async()=>{
  const wrongWallet=async()=>({data:{marketPositions:{items:[{...row,user:{address:"0x"+"b".repeat(40)}}]}}});
  await assert.rejects(discoverMorpho(wallet,1,{request:wrongWallet}),/different wallet/);
  const found=await discoverMorpho(wallet,1,{request:async(url)=>{if(url.endsWith("/graphql"))return {data:{marketPositions:{items:[row]}}};throw new Error("unavailable");}});
  assert.equal(found.positions.length,2);assert.equal(found.positions[0].assets[0].oracleValueUsd,null);assert.ok(found.scope.warnings.length);
});

test("portfolio API serves general schema and coalesces repeat wallet reads",async(t)=>{
  let calls=0;
  const server=createAppServer({savedLoader:async()=>packet,discoveryLoader:async()=>{calls++;return portfolio;}});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await (await fetch(base+"/api/portfolio")).json()).schemaVersion,SCHEMA);
  const url=base+`/api/discover?address=${wallet}&chainId=1`;
  await Promise.all([fetch(url),fetch(url)]);assert.equal(calls,1);
  assert.equal((await fetch(base+"/api/discover?address=invalid&chainId=1")).status,400);
  const batch=await fetch(base+"/api/evaluate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({portfolio})});
  const report=await batch.json();
  assert.equal(batch.status,200);assert.equal(report.reports.length,1);assert.equal(report.reports[0].exitRehearsal.status,"blocked");
  assert.equal((await fetch(base+"/api/evaluate",{method:"POST",body:"not json"})).status,400);
});
