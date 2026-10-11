import { $, esc, usd, usdC, pct, range, api, header } from '/xray.js';
$('#chrome').innerHTML = header('Start');
const THREE = window.THREE;
const ID = 'steakhouse-usdc';
const report = await api(`/api/vault?id=${ID}`);
const m = report.model, token = sym => m.dependencies.find(d => d.kind === 'collateral' && d.label === sym)?.id;
const [btc, cb, gapBtc, book] = await Promise.all([
  api('/api/vault/evaluate', { id: ID, incident: 'price-fall', targetId: 'family:BTC', collateralShock: .35, path: 'gradual', recoveryDiscount: .02 }),
  api('/api/vault/evaluate', { id: ID, incident: 'depeg', targetId: token('cbBTC'), collateralShock: .35, path: 'gradual', recoveryDiscount: .02, happening: true }),
  api('/api/vault/evaluate', { id: ID, incident: 'price-fall', targetId: 'family:BTC', collateralShock: .35, path: 'gap', recoveryDiscount: .05 }),
  api('/api/book')]);
const markets = m.markets.filter(x => x.weight >= .01).sort((a, b) => b.allocated - a.allocated);

// ---------- scene
const host = $('#three'), W = () => host.clientWidth, H = () => host.clientHeight;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(W(), H()); host.prepend(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, W() / H(), .1, 200);
const COL = { bone: 0xece4cf, red: 0xff5a36, blue: 0x7cc4e8, amber: 0xf2c14e, rule: 0x2f425e };
const LAYERS = ['Markets', 'Collateral', 'Issuer / custodian', 'Oracle', 'Chain'];
const Y = i => 3 - i * 1.9, DEPOSIT_Y = 5.6;

// HTML labels projected from 3D anchors; placed by priority so they never overlap.
const overlay = document.createElement('div'); overlay.className = 'labels3d'; host.append(overlay);
const LABELS = [];
function label(text, pos, { prio = 0, layer = null, cls = '', title = '' } = {}) {
  const el = document.createElement('span'); el.className = `lbl ${cls}`; el.innerHTML = text; if (title) el.title = title;
  overlay.append(el); const L = { el, pos: pos.clone(), prio, layer, cls, show: true, w: 0, h: 0 }; LABELS.push(L); return L;
}
const v3 = new THREE.Vector3();
function placeLabels() {
  const w = W(), h = H(), placed = [];
  for (const L of [...LABELS].sort((a, b) => b.prio - a.prio)) {
    if (!L.show) { L.el.style.display = 'none'; continue; }
    v3.copy(L.pos).applyMatrix4(world.matrixWorld).project(camera);
    if (v3.z > 1) { L.el.style.display = 'none'; continue; }
    L.el.style.display = 'block';
    if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    const x = (v3.x + 1) / 2 * w - L.w / 2, y = (1 - v3.y) / 2 * h - L.h;
    const r = { x: x - 3, y: y - 3, X: x + L.w + 3, Y: y + L.h + 3 };
    if (r.x < 0 || r.X > w || r.y < 0 || r.Y > h || placed.some(p => r.x < p.X && r.X > p.x && r.y < p.Y && r.Y > p.y)) { L.el.style.display = 'none'; continue; }
    placed.push(r); L.el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }
}
const short = (s, n = 26) => s.length > n ? s.slice(0, n - 1) + '…' : s;
function box(w, h, d, color, opacity) {
  const g = new THREE.BoxGeometry(w, h, d), mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color, transparent: true, opacity: Math.min(1, opacity * 3 + .2) }));
  mesh.add(edges); mesh.userData.edges = edges; return mesh;
}
const world = new THREE.Group(); scene.add(world);

// layer slabs
const slabs = LAYERS.map((name, i) => {
  const g = new THREE.Group(), plane = box(12.5, .04, 4.2, COL.rule, .18); g.add(plane);
  g.position.y = Y(i); world.add(g);
  label(`<b>${i + 1}</b> ${name}`, new THREE.Vector3(-6.5, Y(i) + .45, -.6), { prio: 100, cls: 'layer', layer: i });
  return g;
});
// deposit
const deposit = box(1.4, .5, 1.4, COL.amber, .35); deposit.position.y = DEPOSIT_Y; world.add(deposit);
label('$1M deposit · Steakhouse USDC', new THREE.Vector3(0, DEPOSIT_Y + .45, 0), { prio: 90, cls: 'amber' });

// one column per market
const total = markets.reduce((a, x) => a + x.weight, 0), span = 11;
let cursor = -span / 2;
const cols = markets.map(mk => {
  const w = Math.max(.35, span * mk.weight / total - .25), x = cursor + (span * mk.weight / total) / 2; cursor += span * mk.weight / total;
  const blind = ['none', 'rate'].includes(mk.sight.peg.state), sees = mk.sight.peg.state === 'sees';
  const cells = LAYERS.map((_, i) => { const color = i === 3 ? (blind ? COL.red : sees ? COL.blue : COL.amber) : COL.bone; const b = box(w, .55, 1.6, color, i === 3 ? .3 : .12); b.position.set(x, Y(i) + .32, 0); world.add(b); return b; });
  const spine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, DEPOSIT_Y - .25, 0), new THREE.Vector3(x, Y(0) + .6, 0)]), new THREE.LineBasicMaterial({ color: COL.amber, transparent: true, opacity: .35 }));
  world.add(spine);
  const oracleText = (mk.oracle?.inputs.map(i => i.description).filter(d => d && !/^Dummy/.test(d)).join(' × ') || (mk.oracle?.vault ? 'vault rate' : 'not decoded'));
  const text = [`<b>${esc(mk.label)}</b> ${pct(mk.weight, 0)}`, esc(short(mk.token?.kind?.replace(' (EUR stablecoin)', '') ?? 'unregistered', 20)),
    esc(short(mk.token?.issuer?.split(' (')[0].split(' via')[0] ?? 'unknown', 20)), esc(short(oracleText, 24)), ''];
  const cls = blind ? 'red' : sees ? 'blue' : 'amber';
  const labels = text.map((t, i) => t ? label(t, new THREE.Vector3(x, Y(i) + .62, .8), { prio: mk.weight * 10, layer: i, cls: i === 3 ? cls : '', title: i === 3 ? oracleText : '' }) : null);
  return { mk, x, w, cells, labels, spine, blind };
});
label('Ethereum mainnet · Morpho Blue core contract', new THREE.Vector3(0, Y(4) + .62, .8), { prio: 50, layer: 4 });
// x-ray scan plane
const scan = new THREE.Mesh(new THREE.PlaneGeometry(13, 4.6), new THREE.MeshBasicMaterial({ color: COL.blue, transparent: true, opacity: .07, side: THREE.DoubleSide, depthWrite: false }));
scan.rotation.x = Math.PI / 2; world.add(scan);
// crack for the depeg step
const crackPts = []; for (let i = 0; i <= 40; i++) crackPts.push(new THREE.Vector3((Math.random() - .5) * .3, DEPOSIT_Y - .3 - i * (DEPOSIT_Y - Y(4)) / 40, .82));
const crack = new THREE.Line(new THREE.BufferGeometry().setFromPoints(crackPts), new THREE.LineBasicMaterial({ color: COL.red })); crack.visible = false; world.add(crack);

// ---------- story (scroll-driven)
const cbCol = cols.find(c => c.mk.label === 'cbBTC'), wbCol = cols.find(c => c.mk.label === 'WBTC');
const blindShare = cols.filter(c => c.blind).reduce((a, c) => a + c.mk.weight, 0);
const d = cb.result.decision;
const btcFeed = book.shared.find(s => s.kind === 'feed' && /^BTC \/ USD/.test(s.label));
const bookBlind = book.shared.filter(s => s.kind === 'blindspot');
const baseRate = gapBtc.result.decision.probability.baseRate;
const STEPS = [
  { focus: -1, html: `<p class="kicker">Fulcrum · Blockchain Student Association hackathon · Belem Capital challenge</p><h1>An X-ray of a DeFi position.</h1><p>Below is one real $1M position in <b>${esc(m.name)}</b>, a ${usdC(m.total * m.usdPrice)} Morpho vault, rebuilt from on-chain data. To the holder it is one line: USDC earning ${pct(m.netApy, 2)}.</p><p>Scroll to take it apart, layer by layer, then break something and see whether you should exit.</p><p class="scrollcue">scroll ↓</p>` },
  { focus: 0, html: `<p class="kicker">Layer 1</p><h2>Markets</h2><p>The vault lends into <b>${m.markets.length} markets</b> with ${m.borrowerCount.toLocaleString('en-US')} borrower positions. Each column is a market, its width is its share of the vault.</p><p>cbBTC alone is ${pct(cbCol.mk.weight, 0)}.</p>` },
  { focus: 1, html: `<p class="kicker">Layer 2</p><h2>Collateral</h2><p>Borrowers post wrapped BTC, staked ETH, a EUR vault share. If collateral loses value faster than it gets liquidated, the lenders, meaning you, absorb the shortfall.</p>` },
  { focus: 2, html: `<p class="kicker">Layer 3</p><h2>Issuer and custodian</h2><p>A token is only worth its underlying if someone keeps it that way. <b>Coinbase</b> holds the BTC behind cbBTC, <b>BitGo</b> behind WBTC; <b>ether.fi</b> and <b>Lido</b> run the staking.</p><p>None of this shows up in the vault balance.</p>` },
  { focus: 3, html: `<p class="kicker">Layer 4</p><h2>Oracle</h2><p>Liquidations only fire when the market's oracle sees the collateral fall, so Fulcrum reads every oracle contract on-chain.</p><p><span style="color:#a6d9f2">Blue</span>: WBTC reads <span class="mono">WBTC / BTC</span> and would see a depeg.<br><span style="color:#ff9a82">Red</span>: cbBTC reads only <span class="mono">BTC / USD</span>, so a cbBTC depeg is invisible to it.</p><p><b>${pct(blindShare, 0)}</b> of this vault sits behind oracles that cannot see a depeg. Aave v3 and Spark price cbBTC the same way.</p>` },
  { focus: 4, html: `<p class="kicker">Layer 5</p><h2>Chain</h2><p>Everything settles on Ethereum through the Morpho Blue contract. All oracle reads come from one block, <span class="mono">${m.observation.oracleBlock}</span>.</p>` },
  { focus: 'btc', html: `<p class="kicker">Shock 1</p><h2>BTC falls 35%, over a few days</h2><p>Both oracles follow the price. Liquidators step in at the boundary because they can still sell within the ${pct(cbCol.mk.lif - 1)} liquidation bonus.</p><p class="big" style="color:var(--sound)">${usd(btc.result.incidentUsd.low)}</p><p>loss on the $1M position. Even as a sudden gap it is ${usd(gapBtc.result.incidentUsd.low)}, and that happened in ${pct(baseRate?.probability, 1)} of 30-day windows since ${baseRate?.from.slice(0, 4)}: <b>stay</b>.</p>` },
  { focus: 'cb', html: `<p class="kicker">Shock 2</p><h2>cbBTC depegs 35%, right now</h2><p>Same size, different layer. The oracle still reads BTC/USD, so nobody gets liquidated, and new borrowers post cheap cbBTC to borrow the market's cash.</p><p class="big" style="color:var(--breach)">${esc(d.verdict)}</p><p>${esc(d.headline)}</p>` },
  { focus: -1, wide: true, html: `<p class="kicker">Compared with a usual risk dashboard</p><h2>The answer comes from the contracts, in dollars.</h2>
    <div class="vs"><div class="h">Usual approach</div><div class="h">Fulcrum</div>
    <div>A 0 to 100 risk score per protocol</div><div>Dollar loss on your position, computed borrower by borrower (${m.borrowerCount.toLocaleString('en-US')} here)</div>
    <div>"Oracle: Chainlink" as a label</div><div>Every oracle contract read on-chain; ${bookBlind.length} blind spots found across the book</div>
    <div>A probability typed in by hand</div><div>Counted from daily prices since ${baseRate?.from.slice(0, 4)}, or the break-even when there's no history</div>
    <div>A fixed liquidation threshold</div><div>Morpho's own liquidation incentive decides whether liquidators show up</div>
    <div>One protocol, or a list of protocol names</div><div>Morpho vaults borrower by borrower, plus the same oracle scan on Aave v3 and Spark</div>
    <div>Ten positions scored one by one</div><div>One shock across a book of 10; BTC/USD sits under ${pct(btcFeed?.bookShare, 0)} of it</div>
    <div>A dashboard that says "high risk"</div><div>A verdict: stay or exit, with the number that would flip it</div></div>` },
  { focus: -1, html: `<p class="kicker">Next</p><h2>That was one position.</h2><p>The tour bar at the top goes through the rest in order: the method, the same shock across a book of 10 positions, a clickable X-ray viewer, every number, and the brief's own PT example.</p><p><a class="btn next" href="/how.html" style="background:var(--phosphor);color:var(--film);border-color:var(--phosphor)">Continue: 2 Method</a></p>` }];

$('#main').innerHTML = STEPS.map((s, i) => `<section class="step" data-i="${i}"><div class="card${s.wide ? ' wide' : ''}">${s.html}</div></section>`).join('');
$('#rail').innerHTML = STEPS.map((_, i) => `<button type="button" aria-label="Step ${i + 1}" data-i="${i}"></button>`).join('');
const sections = [...document.querySelectorAll('.step')];
let step = -1;
function show(i) {
  if (i === step) return; step = i; const s = STEPS[step];
  sections.forEach((el, j) => el.classList.toggle('active', j === step));
  document.body.classList.toggle('dim', !!s.wide);
  $('#rail').querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-current', String(j === step)));
  const layer = typeof s.focus === 'number' ? s.focus : s.focus === 'cb' || s.focus === 'btc' ? 3 : -1;
  slabs.forEach((g, j) => { g.children[0].material.opacity = layer < 0 || j === layer ? .22 : .06; });
  cols.forEach(c => {
    const hot = (s.focus === 'cb' && c === cbCol) || (s.focus === 'btc' && (c === cbCol || c === wbCol));
    c.cells.forEach((b, j) => {
      const on = layer < 0 || j === layer || hot; const base = j === 3 ? .3 : .12;
      b.material.opacity = (on ? base : .03) + (hot ? .25 : 0); b.userData.edges.material.opacity = on ? .9 : .12;
      if (hot && s.focus === 'cb' && j !== 3) b.material.color.set(COL.red); else if (j !== 3) b.material.color.set(COL.bone);
    });
    c.labels.forEach((l, j) => { if (l) l.show = layer < 0 ? j === 0 : j === layer || (hot && j === 0); });
    c.spine.material.opacity = layer <= 0 || hot ? .45 : .1;
  });
  LABELS.filter(L => L.cls === 'layer').forEach(L => L.el.classList.toggle('on', L.layer === layer));
  LABELS.filter(L => L.layer === 4 && !L.cls).forEach(L => L.show = layer === 4);
  crack.visible = s.focus === 'cb'; if (crack.visible) crack.position.x = cbCol.x;
  target.y = layer >= 0 ? Y(layer) + .5 : .6; target.dist = layer >= 0 && typeof s.focus === 'number' ? 16 : 21;
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) show(Number(e.target.dataset.i)); }), { rootMargin: '-45% 0px -45% 0px' });
sections.forEach(s => io.observe(s));
const go = i => sections[Math.max(0, Math.min(sections.length - 1, i))].scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
$('#rail').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(Number(b.dataset.i)); });
addEventListener('keydown', e => { if (e.target.closest('input,select')) return;
  if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(step + 1); }
  if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(step - 1); } });

// ---------- camera: drag to orbit; the page scroll drives the story
const target = { y: .6, dist: 21 }, view = { yaw: -.5, pitch: .32, y: .6, dist: 21 };
let drag = null, idle = 0;
host.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: view.yaw, pitch: view.pitch }; host.setPointerCapture(e.pointerId); });
host.addEventListener('pointermove', e => { if (!drag) return; view.yaw = drag.yaw + (e.clientX - drag.x) * .006; view.pitch = Math.max(-.2, Math.min(1.1, drag.pitch + (e.clientY - drag.y) * .004)); idle = 0; });
host.addEventListener('pointerup', () => drag = null);
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function frame(t) {
  idle++; if (!drag && !reduce && idle > 120) view.yaw += .0012;
  view.y += (target.y - view.y) * .06; view.dist += (target.dist - view.dist) * .06;
  camera.position.set(Math.sin(view.yaw) * Math.cos(view.pitch) * view.dist, view.y + Math.sin(view.pitch) * view.dist, Math.cos(view.yaw) * Math.cos(view.pitch) * view.dist);
  camera.lookAt(0, view.y, 0);
  scan.position.y = reduce ? -10 : DEPOSIT_Y - ((t / 1000 * 1.6) % (DEPOSIT_Y - Y(4) + 1.5));
  renderer.render(scene, camera); placeLabels(); requestAnimationFrame(frame);
}
// Shift the model right of centre on wide screens so the text column stays clear.
function fit() { renderer.setSize(W(), H()); camera.aspect = W() / H(); const shift = W() > 980 ? -W() * .17 : 0; camera.setViewOffset(W(), H(), shift, 0, W(), H()); camera.updateProjectionMatrix(); }
addEventListener('resize', fit); fit();
show(0); requestAnimationFrame(frame);
