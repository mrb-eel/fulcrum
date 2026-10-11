/** Evidence that the Morpho indexer does not provide.
 * 1. Oracle composition read directly from each oracle contract and each feed's own
 *    description(), all at ONE pinned block, so feeds have human names and the
 *    indexer's composition is independently checked.
 * 2. Gas price and ETH/USD at that block, used to price the exit transaction.
 * 3. Daily BTC/USD and ETH/USD closes, used for empirical event frequencies.
 * Every request and raw response is retained, and each packet is fingerprinted. */
import { fetchJson } from './http-client.js';
import { fingerprint } from './core/canonical.js';

export const RPC_URL = 'https://ethereum-rpc.publicnode.com';
export const ETH_USD_FEED = '0x5f4ec3df9cbd43714fe2740f5e3616155c5b8419';
// keccak256 selectors, computed once offline.
const SEL = {
  description: '0x7284e416', decimals: '0x313ce567', latestRoundData: '0xfeaf968c',
  BASE_FEED_1: '0xf50a4718', BASE_FEED_2: '0xdc53858c', QUOTE_FEED_1: '0x56095e11', QUOTE_FEED_2: '0xacfbd39e',
  BASE_VAULT: '0xeaa2d7b4', QUOTE_VAULT: '0x2e6f20a6', symbol: '0x95d89b41', asset: '0x38d52e0f'
};
const ZERO = '0x' + '0'.repeat(40);
const hexAddress = h => (typeof h === 'string' && h.length === 66) ? '0x' + h.slice(-40).toLowerCase() : null;
const hexString = h => {
  if (typeof h !== 'string' || h.length < 130) return null;
  const b = Buffer.from(h.slice(2), 'hex'), off = Number(BigInt('0x' + b.subarray(0, 32).toString('hex')));
  if (off + 32 > b.length) return null;
  const n = Number(BigInt('0x' + b.subarray(off, off + 32).toString('hex')));
  return b.subarray(off + 32, off + 32 + n).toString('utf8');
};
const word = (h, i) => BigInt('0x' + h.slice(2 + 64 * i, 2 + 64 * (i + 1)));
const signed = x => x >= 2n ** 255n ? x - 2n ** 256n : x;

function rpcClient(request, url, reads) {
  let id = 0;
  return async function rpc(calls) {
    const out = [];
    for (let i = 0; i < calls.length; i += 40) {
      const batch = calls.slice(i, i + 40).map(c => ({ jsonrpc: '2.0', id: ++id, method: c.method, params: c.params }));
      const response = await request(url, 'Ethereum RPC', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(batch) });
      if (!Array.isArray(response)) throw new Error('Ethereum RPC: batch response expected.');
      const byId = new Map(response.map(r => [r.id, r]));
      batch.forEach(b => { const r = byId.get(b.id); reads.push({ request: b, response: r ?? null }); out.push(r?.error ? { error: r.error.message ?? 'error' } : { result: r?.result ?? null }); });
    }
    return out;
  };
}

export async function captureEnrichment(packets, { request = fetchJson, url = RPC_URL, now = () => new Date().toISOString(), onProgress = () => {} } = {}) {
  const reads = [], rpc = rpcClient(request, url, reads);
  const [head] = await rpc([{ method: 'eth_getBlockByNumber', params: ['latest', false] }]);
  if (!head.result?.number) throw new Error('Could not read the latest block.');
  const tag = head.result.number, block = { number: Number(BigInt(tag)), timestamp: Number(BigInt(head.result.timestamp)), baseFeePerGas: head.result.baseFeePerGas ? Number(BigInt(head.result.baseFeePerGas)) : null };
  const call = (to, data) => ({ method: 'eth_call', params: [{ to, data }, tag] });
  const oracleAddresses = [...new Set(packets.flatMap(p => p.snapshot.vault.state.allocation.map(a => a.market.oracle?.address?.toLowerCase()).filter(a => a && a !== ZERO)))];
  onProgress(`reading ${oracleAddresses.length} oracle contracts at block ${block.number}`);
  const getters = ['BASE_FEED_1', 'BASE_FEED_2', 'QUOTE_FEED_1', 'QUOTE_FEED_2', 'BASE_VAULT', 'QUOTE_VAULT'];
  const results = await rpc(oracleAddresses.flatMap(o => getters.map(g => call(o, SEL[g]))));
  const oracles = {};
  oracleAddresses.forEach((o, i) => {
    const r = Object.fromEntries(getters.map((g, j) => { const x = results[i * getters.length + j]; return [g, x.error || !x.result || x.result === '0x' ? undefined : hexAddress(x.result)]; }));
    const readable = Object.values(r).some(v => v !== undefined);
    oracles[o] = readable ? { kind: 'morpho-chainlink', ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v && v !== ZERO ? v : null])) } : { kind: 'unreadable', note: 'Not a Morpho Chainlink oracle interface; implementation not traced.' };
  });
  const feedAddresses = [...new Set(Object.values(oracles).flatMap(o => ['BASE_FEED_1', 'BASE_FEED_2', 'QUOTE_FEED_1', 'QUOTE_FEED_2'].map(k => o[k]).filter(Boolean)).concat(ETH_USD_FEED))];
  const vaultAddresses = [...new Set(Object.values(oracles).flatMap(o => [o.BASE_VAULT, o.QUOTE_VAULT]).filter(Boolean))];
  onProgress(`reading ${feedAddresses.length} feeds and ${vaultAddresses.length} conversion vaults`);
  const feedReads = await rpc(feedAddresses.flatMap(f => [call(f, SEL.description), call(f, SEL.decimals), call(f, SEL.latestRoundData)]));
  const feeds = {};
  feedAddresses.forEach((f, i) => {
    const [d, dec, lr] = feedReads.slice(i * 3, i * 3 + 3);
    const decimals = dec.result && dec.result !== '0x' ? Number(BigInt(dec.result)) : null;
    const round = lr.result && lr.result.length >= 2 + 64 * 5 ? { answer: signed(word(lr.result, 1)).toString(), updatedAt: Number(word(lr.result, 3)) } : null;
    feeds[f] = { description: hexString(d.result) ?? null, decimals, answer: round?.answer ?? null, updatedAt: round?.updatedAt ?? null,
      value: round && decimals != null ? Number(BigInt(round.answer)) / 10 ** decimals : null };
  });
  const vaultReads = await rpc(vaultAddresses.flatMap(v => [call(v, SEL.symbol), call(v, SEL.asset)]));
  const conversionVaults = Object.fromEntries(vaultAddresses.map((v, i) => [v, { symbol: hexString(vaultReads[i * 2].result), asset: hexAddress(vaultReads[i * 2 + 1].result) }]));
  const [gas] = await rpc([{ method: 'eth_gasPrice', params: [] }]);
  const snapshot = { schemaVersion: 'fulcrum-enrichment/v1', capturedAt: now(), rpc: url, block, gasPriceWei: gas.result ? Number(BigInt(gas.result)) : null,
    ethUsd: feeds[ETH_USD_FEED]?.value ?? null, oracles, feeds, conversionVaults, vaults: packets.map(p => p.snapshotId), reads,
    sourceDescription: 'Direct eth_call reads of oracle getters, feed description()/decimals()/latestRoundData() and ERC-4626 symbol()/asset(), all pinned to one block.' };
  return { snapshotId: 'enrichment-' + fingerprint(snapshot), snapshot };
}

const BITSTAMP = pair => `https://www.bitstamp.net/api/v2/ohlc/${pair}/`;
export async function captureMarketHistory({ request = fetchJson, now = () => new Date().toISOString(), onProgress = () => {}, from = Date.UTC(2015, 0, 1) / 1000 } = {}) {
  const series = {}, reads = [];
  for (const pair of ['btcusd', 'ethusd']) {
    const rows = new Map(); let start = from;
    // Bitstamp returns a 1000-day window from `start`; a window that begins before the
    // pair was listed comes back short, so paginate on time, not on row count.
    const end = Date.parse(now()) / 1000 - 2 * 86400;
    for (let page = 0; page < 16 && start < end; page++) {
      const url = `${BITSTAMP(pair)}?step=86400&limit=1000&start=${start}`;
      const response = await request(url, 'Bitstamp OHLC', { headers: { accept: 'application/json' } });
      const ohlc = response?.data?.ohlc;
      if (!Array.isArray(ohlc)) throw new Error('Bitstamp OHLC: unexpected response.');
      reads.push({ url, rows: ohlc.length, first: ohlc[0]?.timestamp ?? null, last: ohlc.at(-1)?.timestamp ?? null });
      for (const r of ohlc) rows.set(Number(r.timestamp), Number(r.close));
      start = ohlc.length ? Number(ohlc.at(-1).timestamp) + 86400 : start + 1000 * 86400;
    }
    const closes = [...rows.entries()].sort((a, b) => a[0] - b[0]).filter(([, c]) => Number.isFinite(c) && c > 0);
    series[pair] = { source: BITSTAMP(pair), interval: '1 day (UTC close)', closes };
    onProgress(`${pair}: ${closes.length} daily closes`);
  }
  const snapshot = { schemaVersion: 'fulcrum-market-history/v1', capturedAt: now(), series, reads };
  return { snapshotId: 'history-' + fingerprint(snapshot), snapshot };
}

export function verifySealed(packet, prefix) {
  if (!packet?.snapshot || packet.snapshotId !== `${prefix}-${fingerprint(packet.snapshot)}`) throw new Error(`${prefix} packet fingerprint mismatch.`);
  return packet;
}
