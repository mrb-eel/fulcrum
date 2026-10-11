// Capture every vault in the illustrative book, then the on-chain oracle reads and
// market history that the decision layer needs. Run: node scripts/capture-book.js [vault-id]
import { mkdir, writeFile } from 'node:fs/promises';
import { discoverVault } from '../src/vault-discovery.js';
import { captureEnrichment, captureMarketHistory } from '../src/enrichment.js';
import { BOOK } from '../src/book-config.js';

const only = process.argv[2];
const dir = new URL('../data/book/', import.meta.url);
await mkdir(dir, { recursive: true });
const write = (name, value) => writeFile(new URL(name, dir), JSON.stringify(value, null, 1));

for (const pocket of BOOK.filter(p => !only || p.id === only || only === 'enrichment' || only === 'history')) {
  if (only !== 'enrichment' && only !== 'history') {
    const started = Date.now();
    const packet = await discoverVault(pocket.address, 1, { onProgress: m => console.log(`  ${pocket.id} · ${m}`) });
    await write(`${pocket.id}.json`, packet);
    const s = packet.snapshot;
    console.log(`${pocket.id}: ${Object.keys(s.borrowers).length} markets, ${Object.values(s.borrowers).reduce((n, b) => n + b.items.length, 0)} borrowers, ${((Date.now() - started) / 1000).toFixed(0)}s, warnings ${s.warnings.length}`);
  }
}
if (!only || only === 'enrichment' || BOOK.some(p => p.id === only)) {
  const { readFile } = await import('node:fs/promises');
  const packets = [];
  for (const p of BOOK) { try { packets.push(JSON.parse(await readFile(new URL(`${p.id}.json`, dir), 'utf8'))); } catch { console.log(`skip enrichment for ${p.id}: no capture`); } }
  const enrichment = await captureEnrichment(packets, { onProgress: console.log });
  await write('enrichment.json', enrichment);
  console.log(`enrichment: block ${enrichment.snapshot.block.number}, ${Object.keys(enrichment.snapshot.oracles).length} oracles, ${Object.keys(enrichment.snapshot.feeds).length} feeds`);
}
if (!only || only === 'history') {
  const history = await captureMarketHistory({ onProgress: console.log });
  await write('market-history.json', history);
  console.log(`history: ${Object.entries(history.snapshot.series).map(([k, v]) => `${k} ${v.closes.length} days`).join(', ')}`);
}
