import { $, esc, usd, usdC, pct, range, dither, keys, api, debounce, header } from '/xray.js';
$('#chrome').innerHTML = header('Vault details');
const params = new URLSearchParams(location.search);
let id = params.get('id') || 'steakhouse-usdc', report, path = 'gap', req = 0, layer = 0, selected = null;
const form = $('#controls');
let happening = false;
$('#now').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; happening = b.dataset.v === 'now'; $('#now').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); run(); });
const SIGHT = { sees: 'yes', rate: 'no, issuer rate', none: 'no', unverified: 'unverified', unknown: 'unknown', 'n/a': 'n/a' };
const flag = s => `<span class="flag ${s.state === 'n/a' ? 'na' : s.state}" title="${esc(s.reason)}">${SIGHT[s.state] ?? s.state}</span>`;
const INC = { 'price-fall': 'shock', depeg: 'depeg', 'feed-freeze': 'freeze', 'withdrawal-freeze': 'withdrawal freeze' };

function targetOptions() {
  const deps = report.model.dependencies, inc = $('#incident').value;
  const kinds = { 'price-fall': ['family'], depeg: ['collateral', 'issuer'], 'feed-freeze': ['feed', 'oracle-vault'], 'withdrawal-freeze': ['market', 'collateral'] }[inc];
  return deps.filter(d => kinds.includes(d.kind) && d.exposure / report.model.total >= .005).map(d => [d.id, `${d.label} · ${pct(d.exposure / report.model.total, 1)}`]);
}
function fillTargets() {
  const cur = $('#target').value || report.result.settings.targetId, opts = targetOptions();
  $('#target').innerHTML = opts.length ? opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('') : '<option value="all">Nothing in this vault</option>';
  $('#target').value = opts.some(([v]) => v === cur) ? cur : (opts[0]?.[0] ?? 'all');
}
function settings() {
  const f = new FormData(form), n = k => f.get(k) === '' || f.get(k) == null ? null : Number(f.get(k));
  return { id, incident: f.get('incident'), targetId: f.get('targetId'), collateralShock: n('collateralShock') / 100, recoveryDiscount: n('recoveryDiscount') / 100, path,
    horizonDays: n('horizonDays') ?? 30, positionUsd: n('positionUsd') ?? 1e6, lossLimit: (n('lossLimit') ?? 10) / 100, eventProbability: n('eventProbability') == null ? null : n('eventProbability') / 100,
    extraExitCost: (n('extraExitCost') ?? 0) / 100, otherWithdrawalsUsd: n('otherWithdrawalsUsd') ?? 0, oracleResponse: f.get('oracleResponse'), drain: f.get('drain') === 'on', unpricedMark: f.get('markOracle') === 'on' ? 'oracle' : 'range', happening };
}

function render() {
  const m = report.model, r = report.result, d = r.decision, s = r.settings;
  document.title = `Fulcrum · ${m.name} X-ray`;
  $('#title').textContent = m.name;
  $('#identity').innerHTML = `<a href="https://app.morpho.org/ethereum/vault/${esc(m.address)}" target="_blank" rel="noreferrer">${esc(m.address)}</a> · ${usdC(m.total * m.usdPrice)} · ${m.markets.length} markets · ${m.borrowerCount.toLocaleString('en-US')} borrower positions · net APY ${pct(m.netApy, 2)} · timelock ${Math.round(m.timelockSeconds / 86400)}d`;
  $('#verdict').dataset.v = d.verdict;
  const p = d.probability, ec = d.exitCost;
  $('#verdict').innerHTML = `<p class="eyebrow">${esc($('#target').selectedOptions[0]?.textContent.split(' · ')[0] ?? '')} ${esc(INC[s.incident])}, ${Math.round(s.collateralShock * 100)}%, ${s.path === 'gap' ? 'instant gap' : 'gradual'}${s.happening ? ', in progress' : ''}</p><p class="report-label">Impression</p><div class="word">${esc(d.verdict)}</div><p class="report-label">Finding</p><p class="headline">${esc(d.headline)}</p>
    <dl class="ledger"><dt>Loss given event</dt><dd class="big">${range(r.incidentUsd)}</dd>
    <dt>${p.source === 'now' ? 'Probability' : `Historical frequency (${s.horizonDays}-day windows)`}</dt><dd>${p.source === 'now' ? '100% (in progress)' : p.source === 'never' ? '0 occurrences' : p.value == null ? 'no data' : pct(p.value, 2)}${p.source === 'manual' ? ' (override)' : ''}</dd>
    <dt>Expected loss</dt><dd>${d.expectedLoss ? range(d.expectedLoss) : '—'}</dd>
    <dt>Exit cost</dt><dd class="big">${usd(ec.totalUsd)}</dd>
    <dt class="small" style="grid-column:1/-1">${ec.basis === 'manual' ? 'Supplied manually.' : `${usd(ec.forgoneUsd)} forgone yield + ${ec.gasUsd != null && ec.gasUsd < 10 ? '$' + ec.gasUsd.toFixed(2) : usd(ec.gasUsd)} gas${ec.extraUsd ? ` + ${usd(ec.extraUsd)} extra` : ''}. ${esc(ec.note ?? '')}`}</dt>
    <dt>Break-even probability</dt><dd>${d.breakEven.low == null ? '—' : range(d.breakEven, x => pct(x, 1))}</dd>
    <dt>Withdrawable now</dt><dd>${usd(r.liquidity.afterUsd)}</dd></dl>
    <p class="small" style="margin-top:var(--s3)">${esc(d.reason)}${d.limitBreachIfEvent ? ' <b style="color:var(--breach)">If it happens, your loss limit is breached.</b>' : ''}</p>`;
  sight(); decomp(); curve(); reverse(); markets(); evidence(); layers(); film(); night(false);
  
}

function sight() {
  const m = report.model, rows = m.markets.filter(x => x.weight >= .001).sort((a, b) => b.allocated - a.allocated);
  $('#sight').innerHTML = rows.map(x => `<tr class="${x.sight.peg.state === 'none' || x.sight.peg.state === 'rate' ? 'on' : ''}"><td>${esc(x.label)} <span class="muted mono">${pct(x.lltv)} LLTV</span></td><td class="n">${pct(x.weight)}</td>
    <td class="mono" style="font-size:11px">${x.oracle ? esc([...x.oracle.inputs.map(i => i.description ?? i.address.slice(0, 10)), x.oracle.vault ? `${x.oracle.vault.symbol} rate` : null].filter(Boolean).join(' × ') || 'not decodable') : '—'}<div class="muted">${esc(x.oracle?.verification ?? '')}</div></td>
    <td>${x.token ? `${esc(x.token.link)}<div class="small">${esc(x.token.issuer)} · <a href="${esc(x.token.source)}" target="_blank" rel="noreferrer">source</a></div>` : '<span class="muted">not in registry</span>'}</td>
    <td>${flag(x.sight.peg)}<div class="small">${esc(x.sight.peg.reason)}</div></td><td>${flag(x.sight.family)}</td></tr>`).join('');
}
function decomp() {
  const r = report.result, rows = [['Existing bad debt', 'shortfall before any shock', { low: r.existingUsd, high: r.existingUsd }], ['Scenario loss', 'used by the verdict', r.incidentUsd], ['Unpriced, outside scenario', 'markets without a collateral mark that the shock does not hit', { low: 0, high: r.unrelatedUnknownUsd }]];
  const max = Math.max(1, ...rows.map(x => x[2].high));
  $('#decomp').innerHTML = `<div class="table-wrap"><table><tbody>${rows.map(([l, s, v], i) => `<tr><td>${l}<div class="small">${s}</div></td><td style="width:40%"><div class="bar ${i === 1 ? 'hot' : ''}"><span style="width:${100 * v.high / max}%"></span></div></td><td class="n">${range(v)}</td></tr>`).join('')}</tbody></table></div>`;
}
function curve() {
  const pts = report.curve, s = report.result.settings;
  if (!pts.length) { $('#curve').innerHTML = '<p class="small">A cash freeze has no price-loss curve.</p>'; return; }
  const max = Math.max(s.positionUsd * s.lossLimit * 1.15, ...pts.map(p => p.loss.high), 1), x = v => 56 + v * 480, y = v => 196 - 168 * v / max;
  const hi = pts.map(p => `${x(p.shock)},${y(p.loss.high)}`), lo = pts.map(p => `${x(p.shock)},${y(p.loss.low)}`);
  $('#curve').innerHTML = `<svg viewBox="0 0 560 236" role="img" aria-label="Incident loss as the shock grows" style="width:100%;font:10px var(--mono)"><path d="M56 22V196H536" stroke="var(--rule-2)" fill="none"/>
    <polygon points="${hi.join(' ')} ${[...lo].reverse().join(' ')}" fill="rgba(255,90,54,.18)"/><polyline points="${hi.join(' ')}" fill="none" stroke="var(--breach)" stroke-width="1.5" stroke-dasharray="4 3"/><polyline points="${lo.join(' ')}" fill="none" stroke="var(--breach)" stroke-width="2"/>
    <path d="M56 ${y(s.lossLimit * s.positionUsd)}H536" stroke="var(--phosphor)" stroke-dasharray="2 4"/><text x="540" y="${y(s.lossLimit * s.positionUsd) + 3}" fill="var(--phosphor)" text-anchor="end" dy="-6">loss limit ${pct(s.lossLimit, 0)}</text>
    <path d="M${x(s.collateralShock)} 22V196" stroke="var(--bone-2)" stroke-dasharray="1 3"/><text x="${x(s.collateralShock)}" y="16" fill="var(--bone-2)" text-anchor="middle">you are here</text>
    <text x="52" y="26" fill="var(--muted)" text-anchor="end">${usdC(max)}</text><text x="52" y="198" fill="var(--muted)" text-anchor="end">$0</text><text x="56" y="214" fill="var(--muted)">0%</text><text x="536" y="214" fill="var(--muted)" text-anchor="end">−100% shock</text></svg>
    <p class="small">Scenario loss on the position as the shock grows. Dotted yellow line: loss limit.</p>`;
}
function reverse() {
  const v = report.reverse;
  $('#reverse').innerHTML = !v ? '<p class="small">A cash freeze has no loss threshold.</p>' : `<div class="verdict" style="padding:var(--s4)"><p class="eyebrow">Shock that breaches your ${pct(report.result.settings.lossLimit, 0)} limit</p><div class="word" style="font-size:56px">${v.supportedByPricedBorrowers == null ? 'never' : `−${pct(v.supportedByPricedBorrowers, 0)}`}</div>
    <p class="small">${v.possible === 0 ? 'Missing valuations or existing shortfall already allow a breach before any shock.' : v.possible == null ? 'Even the upper bound stays below your limit.' : `Including unpriced debt it could break at −${pct(v.possible, 0)}.`} </p></div>`;
}
function markets() {
  const r = report.result;
  $('#drivers').innerHTML = r.decision.drivers.length ? `<h3 style="margin-top:var(--s4)">Largest contributors</h3><ul class="stack" style="padding-left:var(--s4)">${r.decision.drivers.map(x => `<li><b>${esc(x.label)}</b>: ${range(x.lossUsd)}${x.drain ? ' (includes borrowing against mispriced collateral)' : ''}<div class="small">${esc(x.response.reason)}</div></li>`).join('')}</ul>` : '';
  $('#markets').innerHTML = r.rows.filter(x => x.allocation > 0).sort((a, b) => b.allocation - a.allocation).map(x => `<tr class="click ${x.affected && x.shock ? 'on' : ''}" data-m="${esc(x.id)}" tabindex="0"><td>${esc(x.label)} <span class="muted mono">${pct(x.lltv)} LLTV</span><div class="small mono">${x.id.slice(0, 10)}…</div></td>
    <td class="n">${usdC(x.allocation * report.model.usdPrice)}</td><td class="n">${x.borrowerCount}</td><td>${x.affected && x.shock ? `<span class="flag ${x.response.state === 'follows' ? 'sees' : 'none'}">${x.response.state === 'follows' ? 'follows' : 'frozen'}</span> <span class="small">(${x.response.basis})</span>` : '<span class="muted">not hit</span>'}</td>
    <td class="n">${pct(x.liquidatorBreakEven)}</td><td class="n">${range(x.incidentUsd)}</td><td class="n">${usd(x.existingUsd)}</td><td class="n">${usdC(x.withdrawable * report.model.usdPrice)}</td></tr>`).join('');
  borrowers();
}
function borrowers() {
  const row = report.result.rows.find(x => x.id === selected);
  $('#borrowers').innerHTML = !row ? '' : `<h3 style="margin:var(--s5) 0 var(--s3)">${esc(row.label)} · largest shortfalls under this incident</h3><div class="table-wrap"><table><thead><tr><th>Borrower</th><th class="n">Debt</th><th class="n">Collateral value</th><th class="n">Shortfall</th><th class="n">Oracle health after</th></tr></thead><tbody>${row.borrowers.map(b => `<tr><td class="mono"><a href="https://etherscan.io/address/${esc(b.address)}" target="_blank" rel="noreferrer">${esc(b.address.slice(0, 10))}…</a></td><td class="n">${usdC(b.debt * report.model.usdPrice)}</td><td class="n">${b.economicValue == null ? 'unpriced' : usdC(b.economicValue * report.model.usdPrice)}</td><td class="n">${b.shortfall == null ? 'unknown' : usdC(b.shortfall * report.model.usdPrice)}</td><td class="n">${b.health == null ? '—' : b.health.toFixed(3)}</td></tr>`).join('')}</tbody></table></div><p class="small">Public addresses, not identified owners. Amounts are market-level; your share is the vault's supply share × your share of the vault.</p>`;
}
function evidence() {
  const m = report.model, r = report.result;
  $('#evidence').innerHTML = `<p class="small">${esc(m.scope)}</p><ul>${[...m.warnings, ...r.assumptions, r.recognition.note, r.liquidity.label].map(x => `<li>${esc(x)}</li>`).join('')}
    <li>Evidence packet ${esc(m.snapshotId.slice(0, 30))}… captured ${esc(new Date(m.capturedAt).toISOString().slice(0, 16).replace('T', ' '))} UTC; oracle reads ${esc((m.context.enrichmentId ?? '').slice(0, 30))}…</li></ul>
    <div class="row"><a class="btn" href="/api/vault/evidence?id=${esc(id)}" target="_blank">Raw evidence</a><a class="btn" href="/api/vault/graph?id=${esc(id)}" target="_blank">Full dependency graph</a><button class="btn" id="export" type="button">Export this analysis</button></div>
    <p class="small"><a href="https://docs.morpho.org/learn/concepts/liquidation/" target="_blank" rel="noreferrer">Morpho liquidation rules</a> · <a href="https://docs.morpho.org/curate/tutorials-v1/bad-debt/" target="_blank" rel="noreferrer">Vault loss recognition</a></p>`;
  $('#export').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); a.download = `fulcrum-${id}.json`; a.click(); };
}

/** Plain cross-section: one column per market, one row per layer. */
function film() {
  const rows = report.result.rows, ms = report.model.markets.filter(x => x.weight >= .01).sort((a, b) => b.allocated - a.allocated);
  const r = x => rows.find(y => y.id === x.id), hit = x => r(x)?.affected && r(x).shock > 0;
  const see = { sees: ['good', 'yes'], rate: ['bad', 'no, issuer rate'], none: ['bad', 'no'], unverified: ['meh', 'unverified'], unknown: ['meh', 'unknown'], 'n/a': ['', 'n/a'] };
  const layer = (name, cell) => `<div class="xrow"><div class="xhead">${name}</div>${ms.map(x => { const [cls, html] = cell(x); return `<div class="xcell ${cls}" style="flex-grow:${Math.max(.6, x.weight * 10)}">${html}</div>`; }).join('')}</div>`;
  $('#xsec').innerHTML = [
    layer('Market', x => [hit(x) ? 'hit' : '', `<b>${esc(x.label)}</b><small>${pct(x.weight, 0)} of vault · ${pct(x.lltv, 0)} LLTV</small>`]),
    layer('Collateral', x => ['', `${esc(x.token?.kind ?? 'not in registry')}`]),
    layer('Issuer / custodian', x => ['', `${esc(x.token?.issuer ?? 'unknown')}`]),
    layer('Oracle reads', x => ['', `<span class="mono" style="font-size:11px">${esc(x.oracle?.inputs.map(i => i.description ?? '?').join(' × ') || (x.oracle?.vault ? 'vault rate only' : "couldn't decode"))}</span>`]),
    layer('Oracle sees depeg', x => { const [c, t] = see[x.sight.peg.state] ?? ['', x.sight.peg.state]; return [c, t]; }),
    layer('Scenario loss', x => { const v = r(x)?.incidentUsd; return [v?.high > 0 ? 'bad' : '', v ? range(v) : '—']; })
  ].join('');
}
function layers() {}
function night(open) {
  const n = $('#night'); n.classList.toggle('open', open); n.setAttribute('aria-hidden', String(!open)); if (!report) return;
  const d = report.result.decision, s = report.result.settings;
  $('#night-word').textContent = d.verdict; $('#night-word').style.color = d.verdict === 'EXIT' ? 'var(--breach)' : d.verdict === 'STAY' ? 'var(--sound)' : 'var(--phosphor)';
  $('#night-line').textContent = `${report.model.name}: ${$('#target').selectedOptions[0]?.textContent.split(' · ')[0]} ${INC[s.incident]} ${Math.round(s.collateralShock * 100)}%. ${d.headline}`;
  $('#night-stamp').textContent = `Oracle reads at block ${report.model.observation.oracleBlock} · deposit ${usd(s.positionUsd)} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  if (open) dither($('#night-film'), (ctx, w, h) => { const g = ctx.createRadialGradient(w * .72, h * .4, 8, w * .72, h * .4, w * .55); g.addColorStop(0, d.verdict === 'EXIT' ? 'rgba(255,90,54,.95)' : 'rgba(236,228,207,.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); }, { cell: 4, height: innerHeight });
}
keys({ onNight: night });

const run = debounce(async () => {
  const rid = ++req; $('#notice').className = 'notice'; $('#notice').textContent = 'Recalculating from the saved evidence…';
  try { const next = await api('/api/vault/evaluate', settings()); if (rid !== req) return; report = next; render(); $('#notice').textContent = 'Recalculated. No new market data was fetched.'; }
  catch (err) { if (rid !== req) return; $('#notice').className = 'notice error'; $('#notice').textContent = `${err.message} The previous result is still shown.`; }
});
form.addEventListener('input', e => { $('#shock-out').textContent = `${form.collateralShock.value}%`; $('#disc-out').textContent = `${form.recoveryDiscount.value}%`; if (e.target.id === 'incident') { fillTargets(); preset(); } run(); });
$('#path').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { setPath(b.dataset.v); run(); } });
function setPath(v) { path = v; $('#path').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v))); }
function preset() { const depeg = !['price-fall', 'withdrawal-freeze'].includes($('#incident').value); setPath(depeg ? 'gradual' : 'gap'); form.recoveryDiscount.value = depeg ? 2 : 5; $('#disc-out').textContent = `${form.recoveryDiscount.value}%`; }
$('#markets').addEventListener('click', e => { const t = e.target.closest('[data-m]'); if (t) { selected = t.dataset.m; borrowers(); } });
$('#pocket').addEventListener('change', async e => { id = e.target.value; history.replaceState(null, '', `?id=${id}`); await load(); });
addEventListener('resize', debounce(() => report && film(), 150));

async function load() {
  $('#notice').textContent = 'Reading the saved vault evidence…';
  try { report = await api(`/api/vault?id=${encodeURIComponent(id)}`); $('#incident').value = report.result.settings.incident === 'collateral-decline' ? 'depeg' : report.result.settings.incident; fillTargets(); setPath(report.result.settings.path); render();
    if (report.result.settings.incident === 'collateral-decline') run();
    $('#notice').textContent = 'Saved evidence loaded. Change anything; it recalculates.'; }
  catch (err) { $('#notice').className = 'notice error'; $('#notice').textContent = `Vault unavailable: ${err.message}`; }
}
try { const b = await api('/api/book'); $('#pocket').innerHTML = b.pockets.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${esc(p.asset)}</option>`).join(''); $('#pocket').value = id; } catch { $('#pocket').innerHTML = `<option>${esc(id)}</option>`; }
await load();
