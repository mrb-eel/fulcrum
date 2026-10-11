// Shared helpers: formatting, ordered dithering, keyboard modes.
export const $ = s => document.querySelector(s);
export const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = n => n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US');
export const usdC = n => n == null ? "—" : Math.abs(n) >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : usd(n);
export const pct = (x, d = 1) => x == null ? '—' : x > 0 && x < .001 ? '<0.1%' : `${(x * 100).toFixed(d)}%`;
export const range = (r, f = usd) => !r ? '—' : Math.abs(r.high - r.low) < 1 ? f(r.low) : `${f(r.low)} – ${f(r.high)}`;
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const INK = [10, 15, 25], BONE = [236, 228, 207], BREACH = [255, 90, 54], SEEN = [124, 196, 232], PHOS = [242, 193, 78];
export const TONES = { bone: BONE, breach: BREACH, seen: SEEN, phosphor: PHOS };

/** Draw with `paint(ctx, w, h)` in greyscale-plus-alpha on a small offscreen canvas, then
 * threshold every pixel against a 4×4 Bayer matrix. Tone is chosen per pixel from the
 * dominant hue the painter used, so data colours survive the dither. */
export function dither(canvas, paint, { cell = 3, height } = {}) {
  const w = Math.max(40, Math.floor(canvas.clientWidth / cell)), h = Math.floor((height ?? canvas.clientHeight) / cell);
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
  paint(ctx, w, h);
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = Math.max(r, g, b) / 255, on = lum > BAYER[(y & 3) * 4 + (x & 3)];
    // Classify by hue ratios so dim (alpha-blended) colours keep their meaning.
    const tone = r > 24 && r > g * 1.7 ? BREACH : b > 24 && b > r * 1.3 ? SEEN : g > 24 && r > b * 1.6 && g > b * 1.3 ? PHOS : BONE;
    const c = on ? tone : INK;
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { w, h };
}

/** Keyboard: T toggles the plain-table fallback, F opens 3 a.m. mode, Esc closes it. */
export function keys({ onNight } = {}) {
  addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 't' || e.key === 'T') { document.body.classList.toggle('only-table'); announce(document.body.classList.contains('only-table') ? 'Table view' : 'Visual view'); }
    if ((e.key === 'f' || e.key === 'F') && onNight) onNight(true);
    if (e.key === 'Escape' && onNight) onNight(false);
  });
}
function announce(text) { let n = $('#announce'); if (!n) { n = document.createElement('div'); n.id = 'announce'; n.setAttribute('aria-live', 'polite'); n.className = 'skip'; document.body.append(n); } n.textContent = text; }

export async function api(url, body) {
  const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const json = await r.json();
  if (!r.ok) throw new Error(json.detail ?? json.error ?? `HTTP ${r.status}`);
  return json;
}
export const debounce = (fn, ms = 180) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export const TOUR = [['/', 'Start', 'The idea in 3D'], ['/how.html', 'Method', 'How it works, 11 slides'], ['/book.html', 'Book', '10 positions, one shock'], ['/xray.html', 'X-ray viewer', 'One vault, click around'], ['/vault.html', 'Vault details', 'Every number'], ['/case.html', 'PT case', "The brief's example"]];
export function tourBar(current) {
  const i = TOUR.findIndex(t => t[1] === current), prev = TOUR[i - 1], next = TOUR[i + 1];
  return `<nav class="tour" aria-label="Guided tour"><ol>${TOUR.map(([h, l, s], j) => `<li${j === i ? ' aria-current="step"' : j < i ? ' class="done"' : ''}><a href="${h}"><span class="n">${j + 1}</span><span><b>${l}</b><small>${s}</small></span></a></li>`).join('')}</ol>
    <div class="tour-nav">${prev ? `<a class="btn" href="${prev[0]}">Back</a>` : ''}${next ? `<a class="btn next" href="${next[0]}">Next: ${next[1]}</a>` : '<a class="btn" href="/portfolio.html">Extra: workspace</a>'}</div></nav>`;
}
export const MARK = '<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M4 13.5 28 9.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/><path d="M16 12.2 10.5 25h11z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="11.6" r="2.4" fill="#ff5a36"/></svg>';
export function header(current) {
  const i = TOUR.findIndex(t => t[1] === current), date = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
  return `<a class="skip" href="#main">Skip to content</a><header class="top"><a class="wordmark" href="/" aria-label="Fulcrum, start">${MARK}<span>fulcrum</span></a>${tourBar(current)}<span class="plate">PLATE ${i + 1}/${TOUR.length} · ${date}</span></header>`;
}
