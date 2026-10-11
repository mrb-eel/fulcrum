import { $, esc, usd, usdC, pct, range, api, header, MARK } from '/xray.js';
$('#chrome').innerHTML = header('Method');
$('#bigmark').innerHTML = MARK;
const slides = [...document.querySelectorAll('.slide')];
let current = 0;
const go = i => { current = Math.max(0, Math.min(slides.length - 1, i)); slides[current].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); };
addEventListener('keydown', e => {
  if (e.target.closest('input,select,textarea')) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(current + 1); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(current - 1); }
});
const obs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { current = slides.indexOf(e.target); $('#pager').textContent = `${current + 1} / ${slides.length}`; } }), { threshold: .55 });
slides.forEach(s => obs.observe(s));

const [book, vault] = await Promise.all([api('/api/book'), api('/api/vault?id=steakhouse-usdc')]);
const m = vault.model, token = sym => m.dependencies.find(d => d.kind === 'collateral' && d.label === sym)?.id;
const ev = body => api('/api/vault/evaluate', { id: 'steakhouse-usdc', ...body });
const [gap, gradual, cb, wb] = await Promise.all([
  ev({ incident: 'price-fall', targetId: 'family:BTC', path: 'gap', collateralShock: .35, recoveryDiscount: .05 }),
  ev({ incident: 'price-fall', targetId: 'family:BTC', path: 'gradual', collateralShock: .35, recoveryDiscount: .02 }),
  ev({ incident: 'depeg', targetId: token('cbBTC'), path: 'gradual', collateralShock: .35, recoveryDiscount: .02 }),
  ev({ incident: 'depeg', targetId: token('WBTC'), path: 'gradual', collateralShock: .35, recoveryDiscount: .02 })]);
const now = await ev({ incident: 'depeg', targetId: token('cbBTC'), path: 'gradual', collateralShock: .35, recoveryDiscount: .02, happening: true });

const markets = book.pockets.reduce((a, p) => a + p.markets, 0), borrowers = book.pockets.reduce((a, p) => a + p.borrowers, 0);
const oracles = new Set(book.shared.filter(s => s.kind === 'feed').map(s => s.key)).size;
$('#cover-stats').innerHTML = [[book.pockets.length, 'real Morpho vaults'], [markets, 'lending markets'], [borrowers.toLocaleString('en-US'), 'borrowers checked'], [book.shared.filter(x => x.kind === 'blindspot').length, 'oracle blind spots found']]
  .map(([n, l]) => `<div class="card"><p class="stat">${n}</p><p>${l}</p></div>`).join('');
$('#cap-1').textContent = `${markets} markets · ${borrowers.toLocaleString('en-US')} borrowers`;
$('#cap-2').textContent = `block ${book.evidence.block.number} · ${m.observation.oracleMismatches} mismatches with the indexer in ${m.name}`;
$('#cap-3').textContent = gap.result.decision.probability.baseRate ? `${gap.result.decision.probability.baseRate.from} to ${gap.result.decision.probability.baseRate.to}` : '';

const cbm = m.markets.filter(x => x.label === 'cbBTC').sort((a, b) => b.allocated - a.allocated)[0];
$('#layers').innerHTML = [['Market', `cbBTC / USDC · ${pct(cbm.lltv)} LLTV · ${pct(cbm.weight)} of ${m.name} · ${cbm.borrowerCount} borrowers`],
  ['Collateral', `cbBTC · ${cbm.token.kind}`], ['Issuer / custodian', `${cbm.token.issuer}: ${cbm.token.role}`],
  ['Oracle', `${cbm.oracle.inputs.map(i => i.description).join(' × ')} · read at block ${cbm.oracle.block}`], ['Chain', `Ethereum mainnet · loan asset ${m.asset.symbol} (${m.loanToken.issuer})`]]
  .map(([n, t], i) => `<div class="layer" aria-current="${i === 3}"><div class="depth">LAYER ${i + 1}<b>${n}</b></div><div>${esc(t)}${i === 3 ? ` <span class="flag none">(can't see cbBTC/BTC)</span>` : ''}</div></div>`).join('');

$('#blind').innerHTML = book.shared.filter(s => s.kind === 'blindspot').slice(0, 7).map(s => `<tr><td>${esc(s.label)}<div class="small">${esc(s.reason ?? '')}</div></td><td class="mono">${s.pockets.length}/10</td><td class="n">${pct(s.bookShare)}</td></tr>`).join('');

const card = (v, cls, l) => `<div class="card"><p class="stat ${cls}">${v}</p><p>${l}</p></div>`;
$('#impact').innerHTML = [card(usd(gap.result.incidentUsd.low), 'hot', 'BTC drops 35% all at once ($1M in Steakhouse USDC)'),
  card(usd(gradual.result.incidentUsd.low), 'ok', 'Same drop, but slowly: liquidations happen in time'),
  card(usd(cb.result.incidentUsd.low), 'hot', "cbBTC depegs 35%: the oracle doesn't notice"),
  card(usd(wb.result.incidentUsd.low), 'ok', 'WBTC depegs 35%: the oracle notices, liquidations work')].join('');

const d = gap.result.decision;
$('#decision').innerHTML = [card(pct(d.probability.value, 2), 'amb', 'of 30-day windows since 2015 had a one-day 35% BTC drop'),
  card(usd(d.expectedLoss?.low), 'hot', 'average loss'), card(usd(d.exitCost.totalUsd), '', `to leave for 30 days (lost interest at ${pct(m.netApy, 2)} + gas)`),
  card(d.verdict, d.verdict === 'EXIT' ? 'hot' : 'ok', 'verdict')].join('');
$('#decision-line').innerHTML = `${esc(d.headline)}<br><br>But if cbBTC is <b>already</b> depegging by 35%, the chance is 100% and the answer flips: <b style="color:var(--breach)">${esc(now.result.decision.verdict)}</b>. ${esc(now.result.decision.headline)}`;

$('#shared').innerHTML = book.shared.filter(s => !['controller'].includes(s.kind)).slice(0, 8).map(s => `<tr><td>${s.kind === 'blindspot' ? '<span class="flag none">blind spot:</span> ' : ''}${esc(s.label)}</td><td class="mono">${'■'.repeat(s.pockets.length)}${'·'.repeat(10 - s.pockets.length)} ${s.pockets.length}/10</td><td class="n">${pct(s.bookShare)}</td></tr>`).join('');
const e = book.evaluation;
$('#book-line').textContent = `If BTC drops 35% at once, ${e.exposedPockets} of the 10 vaults get hit and the book loses ${range(e.incidentUsd)} (${range(e.incidentShare, x => pct(x, 2))} of it). ${e.headline}`;

