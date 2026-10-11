import { $, esc, usd, usdC, pct, range, dither, keys, api, debounce, header, reduced } from '/xray.js';
$('#chrome').innerHTML = header('Book');
let report, path = 'gap', req = 0;
const form = $('#controls');
let happening = false;
$('#now').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; happening = b.dataset.v === 'now'; $('#now').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); run(); });

const KIND = { family: 'Price', collateral: 'Collateral token', issuer: 'Issuer / custodian', feed: 'Price feed', blindspot: 'Oracle blind spot', 'oracle-vault': 'Conversion rate', protocol: 'Protocol', controller: 'Vault control' };
const targetsFor = incident => {
  const s = report.shared;
  if (incident === 'price-fall') return [['family:BTC', 'BTC price'], ['family:ETH', 'ETH price'], ['family:XAU', 'Gold price'], ['family:EUR', 'EUR price']].filter(([id]) => s.some(d => d.key === id) || id === 'family:BTC');
  if (incident === 'depeg') return s.filter(d => d.kind === 'collateral').map(d => [d.id, `${d.label} · ${d.pockets.length} pockets`]);
  return s.filter(d => d.kind === 'feed').map(d => [d.id, `${d.label} · ${d.pockets.length} pockets`]);
};
function fillTargets(keep) {
  const opts = targetsFor($('#incident').value);
  $('#target').innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
  if (keep && opts.some(([v]) => v === keep)) $('#target').value = keep;
}
function settings() {
  const f = new FormData(form);
  return { incident: f.get('incident'), targetId: f.get('targetId'), collateralShock: Number(f.get('collateralShock')) / 100, recoveryDiscount: Number(f.get('recoveryDiscount')) / 100,
    horizonDays: Number(f.get('horizonDays')) || 30, path, happening };
}

function render() {
  const e = report.evaluation, s = report.settings;
  const v = e.exits.length ? 'EXIT' : e.rows.some(r => r.verdict === 'STAY UNLESS') ? 'STAY UNLESS' : e.rows.some(r => r.verdict === 'REVIEW') ? 'REVIEW' : 'STAY';
  $('#verdict').dataset.v = v;
  $('#verdict').innerHTML = `<p class="eyebrow">Book · ${esc(describe(s))}</p><p class="report-label">Impression</p><div class="word">${v}</div><p class="report-label">Finding</p><p class="headline">${esc(e.headline)}${e.warning ? ` <span style="color:var(--breach)">${esc(e.warning)}</span>` : ''}</p>
    <dl class="ledger"><dt>Scenario loss, whole book</dt><dd class="big">${range(e.incidentUsd)}</dd><dt>Share of the $${(e.bookUsd / 1e6).toFixed(0)}M book</dt><dd>${range(e.incidentShare, x => pct(x, 2))}</dd>
    <dt>Positions exposed</dt><dd>${e.exposedPockets} of ${e.rows.length}</dd><dt>Positions to exit</dt><dd>${e.exits.length || 'none'}</dd></dl>`;
  $('#pockets').innerHTML = e.rows.map(r => `<tr class="click${r.exposed ? ' on' : ''}" data-id="${esc(r.id)}"><td><a href="/vault.html?id=${esc(r.id)}">${esc(r.name)}</a><div class="small">${esc(r.note)}</div></td><td class="mono">${esc(r.asset)}</td>
    <td class="n">${pct(r.netApy, 2)}</td><td class="n">${r.exposed ? pct(r.exposureShare, 0) : '—'}</td><td class="n">${r.exposed ? range(r.incidentUsd) : '—'}</td><td class="n">${usd(r.exitCostUsd)}</td>
    <td class="n">${r.breakEven?.low != null ? pct(r.breakEven.low) : '—'}</td><td><span class="flag ${r.verdict.replace(' ', '-')}">${esc(r.verdict)}</span></td><td><a class="mono" href="/vault.html?id=${esc(r.id)}" aria-label="X-ray ${esc(r.name)}">X-ray</a></td></tr>`).join('');
  const target = s.targetId?.replace(/^(feed|oracle-vault|token):\d+:/, '$1:');
  $('#shared').innerHTML = report.shared.slice(0, 24).map(d => `<tr class="${d.key === target ? 'on' : ''}"><td>${d.kind === 'blindspot' ? `<span class="flag none">blind spot:</span> ` : ''}${esc(d.label)}${d.reason && d.kind === 'blindspot' ? `<div class="small">${esc(d.reason)}</div>` : ''}</td><td class="mono">${KIND[d.kind] ?? d.kind}${d.status === 'curated' ? ' · curated' : ''}</td>
    <td><span class="mono">${d.pockets.length}/10</span> <span class="small">${esc(d.pockets.map(p => p.name).join(', '))}</span></td><td class="n">${pct(d.bookShare)}</td><td class="n">${usdC(d.exposureUsd)}</td></tr>`).join('');
  $('#evidence').innerHTML = [`Oracle inputs, feed names and conversion vaults read on-chain at block ${report.evidence.block.number} (${new Date(report.evidence.block.timestamp * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC); packet ${report.evidence.enrichmentId.slice(0, 24)}…`,
    `Markets and every borrower position from the Morpho indexer, one fingerprinted packet per vault, captured ${new Date(report.pockets[0].capturedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    `Event frequencies from daily BTC/USD and ETH/USD closes (Bitstamp), packet ${report.evidence.historyId.slice(0, 24)}…. A frequency is history, not a forecast.`,
    'Issuers, custodians and price families come from a curated registry with a source link per token; they are labelled “curated”.',
    'Equal 10% weights and the $10M book size are hypothetical. None of these vaults is attributed to Belem Capital.',
    'Not modelled: reallocation of fresh cash into a drained market, liquidation capacity limits from DEX depth, and the order in which depositors exit.',
    `<a href="/api/book/enrichment" target="_blank" rel="noreferrer">On-chain reads (JSON)</a> · <a href="/api/book/history" target="_blank" rel="noreferrer">Price history (JSON)</a>`].map(x => `<li>${x}</li>`).join('');
  film(); night(false);
}
const describe = s => `${$('#target').selectedOptions[0]?.textContent.split(' · ')[0] ?? ''} ${({ 'price-fall': 'shock', depeg: 'depeg', 'feed-freeze': 'freeze' })[s.incident]}, ${Math.round(s.collateralShock * 100)}%, ${s.path === 'gap' ? 'instant gap' : 'gradual'}${s.happening ? ', in progress' : ''}`;

function film() {
  const rows = pickRows(), e = report.evaluation, target = report.settings.targetId?.replace(/^(feed|oracle-vault|token):\d+:/, '$1:');
  const short = n => n.replace(/ (USDC|USDT|DAI|ETH|WETH)$/, '').replace('Blue Chip', 'BC');
  $('#matrix').innerHTML = `<thead><tr><th>Dependency</th>${e.rows.map(p => `<th class="p">${esc(short(p.name))} <span class="muted">${esc(p.asset)}</span></th>`).join('')}<th class="n">% of book</th></tr></thead><tbody>`
    + rows.map(d => `<tr class="${d.kind === 'blindspot' ? 'blind' : ''} ${d.key === target ? 'target' : ''}"><td>${esc(d.label)}</td>${e.rows.map(p => { const hit = d.pockets.find(x => x.id === p.id); return `<td class="dot ${hit ? 'on' : ''}">${hit ? pct(hit.share, 0) : ''}</td>`; }).join('')}<td class="n">${pct(d.bookShare)}</td></tr>`).join('')
    + `<tr><td><b>Scenario loss</b></td>${e.rows.map(p => `<td class="dot">${p.incidentUsd.high > 0 ? usdC(p.incidentUsd.high) : '·'}</td>`).join('')}<td class="n">${usdC(e.incidentUsd.high)}</td></tr></tbody>`;
}
function pickRows() {
  const target = report.settings.targetId?.replace(/^(feed|oracle-vault|token):\d+:/, '$1:');
  const pool = report.shared.filter(d => d.kind !== 'protocol' && d.kind !== 'controller');
  const chosen = [...pool.filter(d => d.key === target), ...pool.filter(d => d.kind === 'blindspot').slice(0, 3), ...pool.filter(d => d.kind !== 'blindspot')];
  return [...new Map(chosen.map(d => [d.key, d])).values()].slice(0, 9);
}

function night(open) {
  const n = $('#night'); n.classList.toggle('open', open); n.setAttribute('aria-hidden', String(!open));
  if (!report) return;
  const e = report.evaluation, v = $('#verdict').dataset.v;
  $('#night-word').textContent = v; $('#night-word').style.color = v === 'EXIT' ? 'var(--breach)' : v === 'STAY' ? 'var(--sound)' : 'var(--phosphor)';
  $('#night-line').textContent = `${describe(report.settings)}. ${e.headline} Book loss ${range(e.incidentUsd)}.`;
  $('#night-stamp').textContent = `On-chain reads at block ${report.evidence.block.number} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  if (open) dither($('#night-film'), (ctx, w, h) => { const g = ctx.createRadialGradient(w * .7, h * .4, 10, w * .7, h * .4, w * .6); g.addColorStop(0, v === 'EXIT' ? 'rgba(255,90,54,.9)' : 'rgba(236,228,207,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { cell: 4, height: innerHeight });
}
keys({ onNight: night });

const run = debounce(async () => {
  const id = ++req; $('#notice').textContent = 'Recalculating from the saved evidence…'; $('#notice').className = 'notice';
  try { const next = await api('/api/book/evaluate', settings()); if (id !== req) return; report = next; render(); $('#notice').textContent = 'No new market data was fetched; every number comes from the saved packets.'; }
  catch (err) { if (id !== req) return; $('#notice').className = 'notice error'; $('#notice').textContent = `Could not evaluate: ${err.message}. The previous result is still shown.`; }
});
form.addEventListener('input', e => { $('#shock-out').textContent = `${form.collateralShock.value}%`; $('#disc-out').textContent = `${form.recoveryDiscount.value}%`; if (e.target.id === 'incident') { fillTargets(); preset(); } run(); });
$('#path').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; setPath(b.dataset.v); run(); });
function setPath(v) { path = v; $('#path').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
function preset() { const depeg = $('#incident').value !== 'price-fall'; setPath(depeg ? 'gradual' : 'gap'); form.recoveryDiscount.value = depeg ? 2 : 5; $('#disc-out').textContent = `${form.recoveryDiscount.value}%`; }
addEventListener('resize', debounce(() => report && film(), 150));

try { report = await api('/api/book'); fillTargets(report.settings.targetId); render(); $('#notice').textContent = 'Saved evidence loaded. Change the incident; everything recalculates.'; }
catch (err) { $('#verdict').innerHTML = `<p class="notice error">Book unavailable: ${esc(err.message)}. Run <span class="mono">node scripts/capture-book.js</span> to capture it.</p>`; }
if (!reduced) void 0;

// Aave v3 and Spark: the same oracle check on pooled protocols.
try {
  const L = await api('/api/lending'), SEE = { sees: ['sees', 'yes'], rate: ['rate', 'no, issuer rate'], none: ['none', 'no'], unverified: ['unverified', 'unverified'], unknown: ['unknown', 'not traced'], 'n/a': ['na', 'n/a'] };
  const morphoBlind = new Set(report.shared.filter(d => d.kind === 'blindspot').map(d => d.label.replace("Oracle can't see ", '').split('/')[0].toLowerCase()));
  $('#lending-sum').innerHTML = L.protocols.map(p => `<div class="verdict" style="padding:var(--s4);flex:1;min-width:260px"><p class="eyebrow">${esc(p.name)}</p><p class="mono" style="font-size:28px;margin:0;color:var(--breach)">${pct(p.blindShare, 0)}</p><p class="small" style="margin:var(--s1) 0 0">of ${usdC(p.collateralUsd)} collateral-enabled supply sits behind a price source that cannot see a depeg (${usdC(p.noneUsd)} with no related feed at all)</p></div>`).join('');
  const rows = L.protocols.flatMap(p => p.reserves.filter(r => r.collateral && (r.suppliedUsd ?? 0) > 5e6).map(r => ({ p, r }))).sort((a, b) => b.r.suppliedUsd - a.r.suppliedUsd).slice(0, 24);
  $('#lending').innerHTML = rows.map(({ p, r }) => { const [c, t] = SEE[r.sight.state] ?? ['', r.sight.state], both = ['none', 'rate'].includes(r.sight.state) && morphoBlind.has(r.symbol.toLowerCase());
    return `<tr class="${['none', 'rate'].includes(r.sight.state) ? 'on' : ''}"><td class="mono">${esc(p.name.split(' (')[0])}</td><td><b>${esc(r.symbol)}</b><div class="small">${esc(r.token?.issuer ?? '')}</div></td><td class="n">${usdC(r.suppliedUsd)}</td><td class="n">${pct(r.liquidationThreshold, 0)}</td><td class="n">${pct(r.liquidationBonus - 1, 1)}</td>
      <td class="mono" style="font-size:11px">${esc(r.sourceDescription ?? 'no description()')}</td><td><span class="flag ${c}" title="${esc(r.sight.reason)}">${t}</span></td><td>${both ? '<span class="flag none">blind there too</span>' : ''}</td></tr>`; }).join('');
} catch (err) { $('#lending').innerHTML = `<tr><td colspan="8" class="small">Scan unavailable: ${esc(err.message)}. Run node scripts/capture-lending.js</td></tr>`; }
