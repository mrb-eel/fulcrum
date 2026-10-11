// Capture the Aave v3 and Spark oracle scan: node scripts/capture-lending.js
import { mkdir, writeFile } from 'node:fs/promises';
import { captureLendingScan, analyseLending } from '../src/lending-scan.js';
const packet = await captureLendingScan({ onProgress: console.log });
await mkdir(new URL('../data/book/', import.meta.url), { recursive: true });
await writeFile(new URL('../data/book/lending.json', import.meta.url), JSON.stringify(packet, null, 1));
for (const p of analyseLending(packet).protocols) console.log(`${p.name}: $${(p.collateralUsd / 1e9).toFixed(2)}B collateral-enabled supply, ${(p.blindShare * 100).toFixed(0)}% behind oracles that cannot see a depeg`);
