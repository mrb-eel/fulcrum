/** Oracle coverage on pooled lending protocols (Aave v3 and its fork Spark).
 * For every reserve: the oracle source the pool actually uses (AaveOracle.getSourceOfAsset),
 * that source's own description(), risk parameters from the reserve bitmap, and supplied /
 * borrowed amounts priced with the protocol's own oracle. All reads are pinned to one block.
 * Borrower-level losses are not computed here: Aave pools collateral across all users. */
import { fetchJson } from './http-client.js';
import { fingerprint } from './core/canonical.js';
import { RPC_URL } from './enrichment.js';
import { lookupToken } from './registry.js';

export const PROTOCOLS = [
  { id: 'aave-v3', name: 'Aave v3 Core (Ethereum)', provider: '0x2f39d218133afab8f2b819b1066c7e434ad94e9e', source: 'https://aave.com' },
  { id: 'spark', name: 'Spark (Ethereum)', provider: '0x02c3ea4e34c0cbd694d2adfa2c690eecbc1793ee', source: 'https://spark.fi' }
];
const SEL = { getPool: '0x026b1d5f', getPriceOracle: '0xfca513a8', getReservesList: '0xd1946dbc', getSourceOfAsset: '0x92bf2be0', getAssetPrice: '0xb3596f07',
  getReserveData: '0x35ea6a75', totalSupply: '0x18160ddd', symbol: '0x95d89b41', decimals: '0x313ce567', description: '0x7284e416' };
const pad = a => a.slice(2).toLowerCase().padStart(64, '0');
const addr = h => typeof h === 'string' && h.length >= 66 ? '0x' + h.slice(26, 66).toLowerCase() : null;
const word = (h, i) => BigInt('0x' + h.slice(2 + 64 * i, 2 + 64 * (i + 1)));
function str(h) {
  if (typeof h !== 'string' || h.length < 66) return null;
  try {
    const b = Buffer.from(h.slice(2), 'hex');
    if (b.length === 32) return b.toString('utf8').replace(/\0+$/, '') || null; // bytes32 symbols (e.g. MKR)
    const off = Number(BigInt('0x' + b.subarray(0, 32).toString('hex'))), n = Number(BigInt('0x' + b.subarray(off, off + 32).toString('hex')));
    return b.subarray(off + 32, off + 32 + n).toString('utf8');
  } catch { return null; }
}

export async function captureLendingScan({ request = fetchJson, url = RPC_URL, now = () => new Date().toISOString(), onProgress = () => {} } = {}) {
  const reads = []; let id = 0;
  async function rpc(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 50) {
      const batch = calls.slice(i, i + 50).map(c => ({ jsonrpc: '2.0', id: ++id, method: c.method ?? 'eth_call', params: c.params }));
      const res = await request(url, 'Ethereum RPC', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
      const byId = new Map(res.map(r => [r.id, r]));
      batch.forEach(b => { const r = byId.get(b.id); reads.push({ request: b, response: r ?? null }); out.push(r?.result ?? null); });
    }
    return out;
  }
  const [blockHex] = await rpc([{ method: 'eth_blockNumber', params: [] }]);
  const call = (to, data) => ({ params: [{ to, data }, blockHex] });
  const protocols = [];
  for (const p of PROTOCOLS) {
    const [pool, oracle] = (await rpc([call(p.provider, SEL.getPool), call(p.provider, SEL.getPriceOracle)])).map(addr);
    const [list] = await rpc([call(pool, SEL.getReservesList)]);
    const n = Number(word(list, 1)), assets = [...Array(n)].map((_, i) => '0x' + list.slice(2 + 64 * (2 + i) + 24, 2 + 64 * (3 + i)));
    onProgress(`${p.name}: ${n} reserves`);
    const per = await rpc(assets.flatMap(a => [call(oracle, SEL.getSourceOfAsset + pad(a)), call(oracle, SEL.getAssetPrice + pad(a)), call(pool, SEL.getReserveData + pad(a)), call(a, SEL.symbol), call(a, SEL.decimals)]));
    const reserves = assets.map((asset, i) => {
      const [src, price, rd, sym, dec] = per.slice(i * 5, i * 5 + 5);
      const cfg = rd ? word(rd, 0) : 0n;
      return { asset, symbol: str(sym), decimals: dec ? Number(BigInt(dec)) : null, source: addr(src), priceUsd: price ? Number(BigInt(price)) / 1e8 : null,
        ltv: Number(cfg & 0xffffn) / 1e4, liquidationThreshold: Number((cfg >> 16n) & 0xffffn) / 1e4, liquidationBonus: Number((cfg >> 32n) & 0xffffn) / 1e4,
        aToken: rd ? addr('0x' + rd.slice(2 + 64 * 8, 2 + 64 * 9)) : null, variableDebtToken: rd ? addr('0x' + rd.slice(2 + 64 * 10, 2 + 64 * 11)) : null };
    });
    const more = await rpc(reserves.flatMap(r => [call(r.source, SEL.description), call(r.aToken, SEL.totalSupply), call(r.variableDebtToken, SEL.totalSupply)]));
    reserves.forEach((r, i) => {
      const [d, sup, debt] = more.slice(i * 3, i * 3 + 3), scale = 10 ** (r.decimals ?? 18);
      r.sourceDescription = str(d);
      r.suppliedUsd = sup && r.priceUsd != null ? Number(BigInt(sup)) / scale * r.priceUsd : null;
      r.borrowedUsd = debt && r.priceUsd != null ? Number(BigInt(debt)) / scale * r.priceUsd : null;
    });
    protocols.push({ ...p, pool, oracle, reserves });
  }
  const snapshot = { schemaVersion: 'fulcrum-lending-scan/v1', capturedAt: now(), rpc: url, block: Number(BigInt(blockHex)), protocols, reads };
  return { snapshotId: 'lending-' + fingerprint(snapshot), snapshot };
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** Classify a pooled-protocol oracle source by its own description. Same states as the Morpho scan. */
export function classifySource(symbol, description, token) {
  if (token?.immutable) return { state: 'n/a', reason: `${symbol} is an immutable 1:1 contract.` };
  if (!description) return { state: 'unknown', reason: 'The price adapter exposes no description(); its method is not traced.' };
  const d = description, sym = norm(symbol).replace(/^pt/, ''), base = norm(symbol.replace(/^PT-/, '').split('-')[0]);
  const parts = d.replace(/^(PT\s+)?Capped\s+/i, '').split(/\s*\/\s*|\s+/).map(norm).filter(Boolean);
  const names = parts.includes(sym) || parts.includes(base) || norm(d).includes(base);
  if (token?.peg?.some(p => p.test(d))) return { state: 'sees', reason: `Reads “${d}”.` };
  if (/linear discount/i.test(d)) return { state: 'rate', reason: `“${d}”: a fixed discount schedule, not the Pendle market price.` };
  if (names && /capped/i.test(d) && parts.length >= 3 && !/^usd$/.test(parts[1] ?? '')) return { state: 'rate', reason: `“${d}”: the issuer's exchange rate (capped) times the underlying's price, so a market discount on ${symbol} is not seen.` };
  if (/exchange rate|ratio|fixed/i.test(d)) return { state: 'rate', reason: `“${d}” is an issuer or fixed rate.` };
  if (names) return { state: 'sees', reason: `Reads “${d}”, a feed for ${symbol} itself.` };
  return { state: 'none', reason: `Priced with “${d}”, which does not track ${symbol}; ${token?.link ?? `${symbol} and that asset`} are assumed equal.` };
}

export function analyseLending(packet) {
  const s = packet.snapshot;
  const protocols = s.protocols.map(p => {
    const reserves = p.reserves.filter(r => r.symbol).map(r => {
      const token = lookupToken(r.asset, r.symbol);
      return { ...r, token: token ? { issuer: token.issuer, kind: token.kind, link: token.link, source: token.source } : null, sight: classifySource(r.symbol, r.sourceDescription, token),
        collateral: r.liquidationThreshold >= .01, emodeOnly: r.liquidationThreshold > 0 && r.liquidationThreshold < .01 };
    }).sort((a, b) => (b.suppliedUsd ?? 0) - (a.suppliedUsd ?? 0));
    const coll = reserves.filter(r => r.collateral && r.suppliedUsd);
    const total = coll.reduce((a, r) => a + r.suppliedUsd, 0), blind = coll.filter(r => ['none', 'rate'].includes(r.sight.state));
    return { id: p.id, name: p.name, pool: p.pool, oracle: p.oracle, source: p.source, reserves, collateralUsd: total,
      blindUsd: blind.reduce((a, r) => a + r.suppliedUsd, 0), blindShare: total ? blind.reduce((a, r) => a + r.suppliedUsd, 0) / total : 0,
      noneUsd: coll.filter(r => r.sight.state === 'none').reduce((a, r) => a + r.suppliedUsd, 0) };
  });
  return { snapshotId: packet.snapshotId, capturedAt: s.capturedAt, block: s.block, protocols,
    note: 'Supplied amounts of collateral-enabled reserves, priced with each protocol’s own oracle. Supplied is not the same as posted as collateral. E-mode categories can raise thresholds for some assets.' };
}
