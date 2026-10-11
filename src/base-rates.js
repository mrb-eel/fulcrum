/** Empirical event frequencies from daily closes. These are backward-looking counts,
 * not forecasts: they anchor the decision instead of leaving the probability blank.
 *  - gap:     share of H-day windows containing a single-day close-to-close fall >= shock
 *             (a move too fast for liquidations to keep up, at daily resolution).
 *  - gradual: share of H-day windows whose lowest close is >= shock below the first close.
 * Overlapping windows are not independent, so distinct episodes are reported too. */
const DAY = 86400;

export function relativeSeries(history, base, quote) {
  const pick = f => f === 'USD' ? null : history?.series?.[`${f.toLowerCase()}usd`]?.closes;
  const b = pick(base), q = pick(quote);
  if (!b || (quote !== 'USD' && !q)) return null;
  if (quote === 'USD') return { closes: b, label: `${base}/USD`, source: history.series[`${base.toLowerCase()}usd`].source };
  const qm = new Map(q);
  const closes = b.filter(([t]) => qm.has(t)).map(([t, c]) => [t, c / qm.get(t)]);
  return { closes, label: `${base}/${quote}`, source: `${history.series[`${base.toLowerCase()}usd`].source} ÷ ${history.series[`${quote.toLowerCase()}usd`].source}` };
}

export function eventFrequency(series, { shock, horizonDays = 30, path = 'gap' } = {}) {
  if (!series || !(shock > 0) || !(horizonDays >= 1)) return null;
  const c = series.closes, H = Math.round(horizonDays), n = c.length;
  if (n < H + 30) return null;
  // Day index of every qualifying move.
  const hitDay = new Array(n).fill(false);
  if (path === 'gap') for (let i = 1; i < n; i++) hitDay[i] = c[i][1] / c[i - 1][1] - 1 <= -shock;
  let windows = 0, hits = 0, worst = 0;
  const episodes = [];
  for (let t = 0; t + H < n; t++) {
    windows++;
    let hit = false;
    if (path === 'gap') { for (let k = t + 1; k <= t + H; k++) if (hitDay[k]) { hit = true; break; } }
    else { let low = Infinity; for (let k = t + 1; k <= t + H; k++) low = Math.min(low, c[k][1]); const dd = low / c[t][1] - 1; worst = Math.min(worst, dd); hit = dd <= -shock; }
    if (hit) { hits++; if (!episodes.length || c[t][0] - episodes.at(-1).end > H * DAY) episodes.push({ start: c[t][0], end: c[t][0] }); else episodes.at(-1).end = c[t][0]; }
  }
  if (path === 'gap') for (let i = 1; i < n; i++) worst = Math.min(worst, c[i][1] / c[i - 1][1] - 1);
  return { probability: hits / windows, hits, windows, episodes: episodes.map(e => new Date(e.start * 1000).toISOString().slice(0, 10)),
    worstMove: worst, from: new Date(c[0][0] * 1000).toISOString().slice(0, 10), to: new Date(c[n - 1][0] * 1000).toISOString().slice(0, 10),
    label: series.label, source: series.source, path, shock, horizonDays: H,
    definition: path === 'gap' ? `Share of ${H}-day windows with a one-day ${series.label} fall of at least ${(shock * 100).toFixed(0)}%` : `Share of ${H}-day windows where ${series.label} closed at least ${(shock * 100).toFixed(0)}% below the window's first close` };
}
