/** A book of ten 10% pockets (the brief's own example). Each pocket is a real vault;
 * the same incident is applied to every pocket, and dependencies shared across pockets
 * are surfaced because diversification by pocket count can hide a single point of failure. */
import { readFile } from 'node:fs/promises';
import { buildVaultModel, evaluateVault } from './vault-engine.js';
import { verifyVaultPacket } from './vault-discovery.js';
import { verifySealed } from './enrichment.js';
import { BOOK, BOOK_SIZE_USD } from './book-config.js';

const sum = xs => xs.reduce((a, b) => a + b, 0);
const dir = new URL('../data/book/', import.meta.url);
const read = async name => JSON.parse(await readFile(new URL(name, dir), 'utf8'));

export async function loadBook() {
  const enrichment = verifySealed(await read('enrichment.json'), 'enrichment');
  const history = verifySealed(await read('market-history.json'), 'history');
  const pockets = [];
  for (const p of BOOK) {
    const packet = verifyVaultPacket(await read(`${p.id}.json`));
    pockets.push({ ...p, packet, model: buildVaultModel(packet, { enrichment, history }) });
  }
  return { pockets, enrichment, history };
}

const SHARED_KINDS = ['family', 'collateral', 'issuer', 'feed', 'blindspot', 'oracle-vault', 'protocol'];

export function sharedDependencies(pockets, bookUsd = BOOK_SIZE_USD) {
  const per = bookUsd / pockets.length, map = new Map();
  for (const p of pockets) {
    const m = p.model, size = Math.min(per, m.total * m.usdPrice);
    for (const d of m.dependencies.filter(d => SHARED_KINDS.includes(d.kind))) {
      const key = d.id.replace(/^(feed|oracle-vault|token):\d+:/, '$1:');
      if (!map.has(key)) map.set(key, { id: d.id, key, label: d.label, kind: d.kind, status: d.status, reason: d.reason ?? null, pockets: [], exposureUsd: 0 });
      const s = map.get(key);
      s.pockets.push({ id: p.id, name: m.name, share: d.exposure / m.total });
      s.exposureUsd += size * d.exposure / m.total;
    }
    for (const role of ['owner', 'curator']) if (m[role]) {
      const key = `controller:${m[role].toLowerCase()}`;
      if (!map.has(key)) map.set(key, { id: key, key, label: `Vault ${role} ${m[role].slice(0, 6)}…${m[role].slice(-4)}`, kind: 'controller', status: 'observed', pockets: [], exposureUsd: 0 });
      const s = map.get(key); if (!s.pockets.some(x => x.id === p.id)) { s.pockets.push({ id: p.id, name: m.name, share: 1 }); s.exposureUsd += size; }
    }
  }
  return [...map.values()].map(s => ({ ...s, bookShare: s.exposureUsd / bookUsd }))
    .filter(s => s.pockets.length > 1 || s.kind === 'blindspot')
    .sort((a, b) => b.exposureUsd - a.exposureUsd);
}

/** Targets are matched across pockets by economic identity (same token / feed address), not by vault-local id. */
export function evaluateBook(book, options = {}) {
  const bookUsd = options.bookUsd ?? BOOK_SIZE_USD, per = bookUsd / book.pockets.length;
  const key = id => id?.replace(/^(feed|oracle-vault|token):\d+:/, '$1:');
  const rows = book.pockets.map(p => {
    const m = p.model, positionUsd = Math.min(per, m.total * m.usdPrice);
    const target = options.targetId === 'all' ? { id: 'all' } : m.dependencies.find(d => key(d.id) === key(options.targetId));
    const base = { ...options, positionUsd, bookUsd: undefined };
    if (!target) {
      const r = evaluateVault(m, { ...base, incident: 'collateral-decline', targetId: 'all', collateralShock: 0, eventProbability: null });
      return { id: p.id, name: m.name, note: p.note, asset: m.asset.symbol, positionUsd, exposed: false, existingUsd: r.existingUsd, incidentUsd: { low: 0, high: 0 },
        unrelatedUnknownUsd: r.unrelatedUnknownUsd, verdict: 'STAY', headline: 'No exposure.', availableUsd: r.liquidity.afterUsd, exitCostUsd: r.decision.exitCost.totalUsd, drivers: [], netApy: m.netApy };
    }
    const r = evaluateVault(m, { ...base, targetId: target.id });
    return { id: p.id, name: m.name, note: p.note, asset: m.asset.symbol, positionUsd, exposed: true, exposureShare: target.exposure ? target.exposure / m.total : 1,
      existingUsd: r.existingUsd, incidentUsd: r.incidentUsd, unrelatedUnknownUsd: r.unrelatedUnknownUsd, verdict: r.decision.verdict, headline: r.decision.headline,
      availableUsd: r.liquidity.afterUsd, exitCostUsd: r.decision.exitCost.totalUsd, breakEven: r.decision.breakEven, probability: r.decision.probability.value,
      expectedLoss: r.decision.expectedLoss, drivers: r.decision.drivers, netApy: m.netApy, reason: r.decision.reason };
  });
  const incident = { low: sum(rows.map(r => r.incidentUsd.low)), high: sum(rows.map(r => r.incidentUsd.high)) };
  const exits = rows.filter(r => r.verdict === 'EXIT');
  const breach = incident.low / bookUsd >= (options.lossLimit ?? .1);
  return { bookUsd, pocketUsd: per, rows, incidentUsd: incident, incidentShare: { low: incident.low / bookUsd, high: incident.high / bookUsd },
    exposedPockets: rows.filter(r => r.exposed).length, exits: exits.map(r => r.id),
    headline: exits.length ? `Exit ${exits.map(r => r.name).join(', ')}.` :
      rows.some(r => r.verdict === 'STAY UNLESS') ? `Stay unless you think this is likely: the most exposed position is worth exiting above a ${(Math.min(...rows.filter(r => r.breakEven?.low != null).map(r => r.breakEven.low)) * 100).toFixed(2)}% probability.` :
      rows.some(r => r.verdict === 'REVIEW') ? 'Too close to call for at least one position (unpriced collateral).' : 'Stay in all positions: expected loss is below exit cost everywhere.',
    breach, warning: breach ? `If it happens the book loses ${(incident.low / bookUsd * 100).toFixed(1)}%, above a ${((options.lossLimit ?? .1) * 100).toFixed(0)}% loss limit.` : null };
}
