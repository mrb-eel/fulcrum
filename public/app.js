import { analyzePacket } from "/engine/analysis.js";

const $ = (selector) => document.querySelector(selector);
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
const pct = (value, digits = 1) => (value * 100).toFixed(digits) + "%";
const short = (value) => value.slice(0, 6) + "…" + value.slice(-4);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (value) => { try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) ? esc(u.href) : "#"; } catch { return "#"; } };
const date = (value) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(value)) + " · Zurich";
const inputs = { underlyingHaircut: $("#underlying"), exitDiscount: $("#exit"), lossLimit: $("#loss-limit") };
let packet = null;
let savedPacket = null;
let dataMode = "saved";
let selectedNode = "oracle";
let currentAnalysis = null;
let refreshInFlight = false;
const compactMap = window.matchMedia("(max-width: 620px)");

function parameters() {
  return {
    underlyingHaircut: Number(inputs.underlyingHaircut.value) / 100,
    exitDiscount: Number(inputs.exitDiscount.value) / 100,
    lossLimit: Number(inputs.lossLimit.value) / 100,
    eventProbability: $("#use-probability").checked ? Number($("#probability").value) / 100 : null
  };
}

function setNotice(text, kind = "info", detail = "") {
  const notice = $("#status");
  notice.hidden = !text;
  notice.className = "notice " + kind;
  notice.replaceChildren();
  const message = document.createElement("span");
  message.textContent = text;
  notice.append(message);
  if (detail) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Connection details";
    const body = document.createElement("p");
    body.textContent = detail;
    details.append(summary, body); notice.append(details);
  }
}

function renderHeader() {
  const { snapshot } = packet;
  $("#data-badge").textContent = dataMode === "live" ? "Live capture" : "Saved case";
  $("#data-badge").className = "badge " + dataMode;
  $("#data-time").textContent = date(snapshot.observedAt);
  $("#restore").hidden = dataMode !== "live";
  $("#position-link").textContent = short(snapshot.caseDefinition.position) + " ↗";
  $("#position-link").href = "https://etherscan.io/address/" + snapshot.caseDefinition.position;
  $("#maturity").textContent = new Date(snapshot.caseDefinition.expiry).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function renderMetrics(analysis) {
  const b = analysis.scenario.baseline;
  const metrics = [
    ["Collateral reference", money(b.exitValueUsd), "PT-sUSDe at the reference rate"],
    ["Borrowed", money(b.debtUsd), "USDC loan"],
    ["Equity", money(b.equityUsd), "Reference value less the loan"],
    ["Room to liquidation", pct(1 - 1 / b.healthFactor), "Fall in the oracle price"]
  ];
  $("#metrics").innerHTML = metrics.map(([label, value, note]) => `<div class="metric"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join("");
}

function nodeMarkup(id, x, y, label, sub, path, circle = false) {
  return `<g class="map-node ${path} ${id === selectedNode ? "selected" : ""}" role="button" tabindex="0" aria-label="Inspect ${esc(label)}" aria-pressed="${id === selectedNode}" data-node="${id}" transform="translate(${x} ${y})">
    ${circle ? '<circle class="node-halo" r="62"/><circle class="node-body" r="49"/>' : '<rect class="node-body" x="-65" y="-31" width="130" height="62" rx="4"/>'}
    <text class="node-title" text-anchor="middle" y="-2">${esc(label)}</text><text class="node-subtitle" text-anchor="middle" y="18">${esc(sub)}</text></g>`;
}

function renderMap() {
  const rate = pct(packet.snapshot.rawInputs.oracleInvestigation.feeds.pendleLinearDiscount.baseDiscountPerYear, 0);
  const map = $("#dependency-map");
  map.innerHTML = `<svg viewBox="0 0 840 462" aria-label="Position dependencies. Select a node for its source and explanation.">
    <defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".8" fill="currentColor"/></pattern><marker id="arrow-market" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8" fill="#e69b74"/></marker><marker id="arrow-loan" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L8 4L0 8" fill="#9aafc7"/></marker></defs>
    <rect width="840" height="462" fill="url(#dots)" class="dot-grid"/>
    <g class="path-common"><path d="M148 225H178 M308 225H350" class="wire"/><text x="210" y="167" class="map-caption">WHAT THE PT DEPENDS ON</text></g>
    <g class="path-market"><path d="M440 200 C475 200 465 104 515 104 M645 104H688" class="wire sale" marker-end="url(#arrow-market)"/><text x="545" y="44" class="map-caption market-text">SELLING THE PT</text><text x="563" y="160" class="edge-label">market quote</text></g>
    <g class="path-loan"><path d="M440 250 C475 250 465 313 515 313 M645 313H688" class="wire loan" marker-end="url(#arrow-loan)"/><text x="541" y="256" class="map-caption loan-text">VALUING THE LOAN</text></g>
    <g class="path-loan backup-wire"><path d="M646 417H721Q755 417 755 348" class="wire backup"/><text x="668" y="395" class="edge-label">after switch</text></g>
    ${nodeMarkup("ethena",83,225,"Ethena","yield source","path-common")}
    ${nodeMarkup("susde",243,225,"sUSDe","underlying","path-common")}
    ${nodeMarkup("pt",398,225,"PT-sUSDe","collateral","path-common",true)}
    ${nodeMarkup("pendle",580,104,"Pendle","sale route","path-market")}
    ${nodeMarkup("usdc",755,104,"USDC","quote proceeds","path-market")}
    ${nodeMarkup("oracle",580,313,"PT price rule",rate+" annual discount","path-loan")}
    ${nodeMarkup("morpho",755,313,"Morpho","loan health","path-loan")}
    ${nodeMarkup("backup",580,417,"USDe / USD","backup input","path-loan")}
    <g class="no-link" aria-hidden="true"><path d="M581 151V199 M581 218V265"/><circle cx="581" cy="209" r="10"/><path d="M577 205L585 213 M585 205L577 213"/><text x="599" y="213">no direct feed</text></g>
  </svg>`;
  if (compactMap.matches) {
    // Reflow the same dependencies into two vertical routes on narrow screens.
    map.innerHTML = `<svg viewBox="0 0 360 634" aria-label="Position dependencies. Select a node for its source and explanation.">
      <g class="path-common"><path d="M180 81V113 M180 175V195" class="wire"/></g>
      <g class="path-market"><path d="M145 277C113 292 84 305 84 339 M84 401V451" class="wire sale"/><text x="84" y="322" text-anchor="middle" class="map-caption market-text">SELLING</text></g>
      <g class="path-loan"><path d="M215 277C247 292 276 305 276 339 M276 401V451" class="wire loan"/><text x="276" y="322" text-anchor="middle" class="map-caption loan-text">LOAN VALUE</text></g>
      <g class="path-loan"><path d="M276 553V513" class="wire backup"/><text x="195" y="537" class="edge-label">after switch</text></g>
      ${nodeMarkup("ethena",180,50,"Ethena","yield source","path-common")}
      ${nodeMarkup("susde",180,144,"sUSDe","underlying","path-common")}
      ${nodeMarkup("pt",180,244,"PT-sUSDe","collateral","path-common",true)}
      ${nodeMarkup("pendle",84,370,"Pendle","sale route","path-market")}
      ${nodeMarkup("usdc",84,482,"USDC","quote proceeds","path-market")}
      ${nodeMarkup("oracle",276,370,"PT price rule",rate+" annual discount","path-loan")}
      ${nodeMarkup("morpho",276,482,"Morpho","loan health","path-loan")}
      ${nodeMarkup("backup",276,584,"USDe / USD","backup input","path-loan")}
      <g class="no-link" aria-hidden="true"><path d="M150 370H170 M190 370H210"/><circle cx="180" cy="370" r="10"/><path d="M176 366L184 374 M184 366L176 374"/><text x="180" y="422" text-anchor="middle">no direct feed</text></g>
    </svg>`;
  }
  for (const node of map.querySelectorAll("[data-node]")) {
    const select = () => { selectedNode = node.dataset.node; renderMap(); renderInspector(); };
    node.addEventListener("click", select);
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); const id = node.dataset.node; select(); map.querySelector('[data-node="' + id + '"]').focus(); }
    });
  }
}

function renderInspector() {
  const raw = packet.snapshot.rawInputs;
  const trace = raw.oracleInvestigation;
  const market = packet.snapshot.caseDefinition.pendleMarket;
  const cards = {
    ethena: { category: "Underlying exposure", title: "Ethena supplies the underlying.", body: "Pendle identifies Ethena as the source protocol for this market. The PT still depends on what happens to its underlying asset.", facts: [["Observed protocol", raw.pendleMarket.protocol]], note: "This study does not audit Ethena’s exchange, custody or hedge counterparties.", link: "https://app.pendle.finance/trade/markets/" + market, linkLabel: "Open the market" },
    susde: { category: "Underlying reference", title: "The sUSDe reference price.", body: "The model combines a PT-to-sUSDe conversion rate with a USD reference for sUSDe.", facts: [["sUSDe reference", "$" + Number(raw.underlyingPrice.price).toFixed(4)], ["PT → sUSDe", Number(raw.pendleSwap.ptToUnderlyingTokenRate).toFixed(6)]], note: "These inputs can have different update times. Their product is a reference price, not a quote to sell the whole position.", link: "https://api.morpho.org/v0/tokens/1:" + raw.underlyingPrice.address + "/price", linkLabel: "Open price source" },
    pt: { category: "Collateral", title: "PT pledged against the loan.", body: "PT-sUSDe is pledged to Morpho. To model a sale, we look at Pendle. To calculate loan health, we use Morpho’s oracle.", facts: [["PT quantity", Number(currentAnalysis.scenario.baseline.collateralPt).toLocaleString("en-GB", { maximumFractionDigits: 0 })], ["Maturity", $("#maturity").textContent]], note: "The collateral is pledged. A swap quote alone does not prove it can be withdrawn.", link: "https://etherscan.io/token/" + raw.market.collateral_token, linkLabel: "Inspect the token" },
    pendle: { category: "Sale route", title: "A separate quote for each sale.", body: "The saved case includes separate PT-to-USDC quotes for selling 25%, 50% and 100% of the collateral.", facts: [["Quoted sale sizes", "25% · 50% · 100%"], ["Slippage setting", pct(Number(raw.exitQuotes[0]?.request.slippage ?? 0.01), 0)]], note: "Expected output is not a guaranteed fill. Gas and the loan-unwind route are not priced here.", link: "https://app.pendle.finance/trade/markets/" + market, linkLabel: "Open Pendle" },
    usdc: { category: "Loan and proceeds", title: "The loan is owed in USDC.", body: "The sale quotes return USDC. The position also owes USDC. We convert quote proceeds with the same USD rate used for the debt.", facts: [["Loan balance", Number(currentAnalysis.scenario.baseline.loanDebt).toLocaleString("en-GB", { maximumFractionDigits: 0 }) + " USDC"]], note: "Net proceeds also depend on repaying the loan, transaction fees and financing.", link: "https://etherscan.io/token/" + raw.market.loan_token, linkLabel: "Inspect USDC" },
    oracle: { category: "Contract finding", title: "The primary uses a fixed discount.", body: "The selected primary feed uses a fixed annual PT discount. It does not take the current Pendle sale price as an input.", facts: [["Annual discount", pct(trace.feeds.pendleLinearDiscount.baseDiscountPerYear, 0)], ["Selected feed", trace.oracle.isPrimary ? "Primary" : "Backup"]], note: "It is fixed with respect to these price shocks; its time-to-maturity discount still changes over time.", link: trace.feeds.pendleLinearDiscount.sourceUrl, linkLabel: "Read the verified contract" },
    morpho: { category: "Lending constraint", title: "Liquidation starts below 1.000.", body: "Morpho health compares oracle-valued collateral with the loan balance. It can stay above liquidation while the market value falls.", facts: [["Health factor", currentAnalysis.scenario.result.healthFactor.toFixed(3)], ["Liquidation LTV", pct(Number(raw.market.lltv_wad)/1e18)]], note: "Calculated in USDC units from PT quantity, oracle price, debt and LLTV. This is a point-in-time view.", link: "https://app.morpho.org/ethereum/market/" + raw.market.market_id, linkLabel: "Open Morpho market" },
    backup: { category: "Conditional path", title: "The backup reads USDe / USD.", body: "The backup also reads USDe / USD. Switching is subject to the meta-oracle’s deviation and timelock process.", facts: [["Deviation threshold", pct(trace.oracle.deviationThreshold, 2)], ["Challenge delay", trace.oracle.challengeTimelockSeconds/3600 + " hours"], ["Healing delay", trace.oracle.healingTimelockSeconds/3600 + " hours"]], note: "A delay setting is not a promise that a switch happens automatically after that time. The transition is not simulated here.", link: trace.oracle.implementation.sourceUrl, linkLabel: "Inspect the switching rules" }
  };
  const card = cards[selectedNode];
  $("#inspector").innerHTML = `<div class="inspector-top"><span class="inspector-label">${esc(card.category)}</span><span class="inspect-index">${String(Object.keys(cards).indexOf(selectedNode)+1).padStart(2,"0")} / 08</span></div><h3>${esc(card.title)}</h3><p>${esc(card.body)}</p><dl>${card.facts.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl><p class="inspector-note">${esc(card.note)}</p><a href="${safeUrl(card.link)}" target="_blank" rel="noreferrer">${esc(card.linkLabel)} ↗</a>`;
}

function renderChart(analysis) {
  const { curve, scenario, thresholdExitDiscount } = analysis;
  const settings = parameters();
  const W = Math.max(300, Math.round($("#loss-chart").clientWidth) || 700), H = 250, left = 45, right = 24, top = 20, bottom = 36;
  const maxY = Math.max(0.2, Math.ceil(Math.max(curve.at(-1).equityLossFraction, settings.lossLimit) * 10) / 10);
  const x = (value) => left + value / 0.1 * (W-left-right);
  const y = (value) => H-bottom - value / maxY * (H-top-bottom);
  const points = curve.map((point) => x(point.exitDiscount).toFixed(2) + "," + y(point.equityLossFraction).toFixed(2)).join(" ");
  const area = left + "," + (H-bottom) + " " + points + " " + (W-right) + "," + (H-bottom);
  const currentX = x(settings.exitDiscount), currentY = y(scenario.result.equityLossFraction);
  const grid = [0,.25,.5,.75,1].map((fraction) => `<line x1="${left}" x2="${W-right}" y1="${y(maxY*fraction)}" y2="${y(maxY*fraction)}" class="chart-grid"/><text x="${left-10}" y="${y(maxY*fraction)+4}" text-anchor="end">${pct(maxY*fraction,0)}</text>`).join("");
  const ticks = [0,.02,.04,.06,.08,.1].map((value)=>`<text x="${x(value)}" y="${H-14}" text-anchor="middle">${pct(value,0)}</text>`).join("");
  $("#loss-chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="At ${pct(settings.exitDiscount)} extra exit discount, equity loss is ${pct(scenario.result.equityLossFraction)}. The loss limit is ${pct(settings.lossLimit,0)}."><title>Modelled equity loss by extra exit discount</title>${grid}<polygon points="${area}" class="loss-area"/><line x1="${left}" x2="${W-right}" y1="${y(settings.lossLimit)}" y2="${y(settings.lossLimit)}" class="limit-line"/><text x="${W-right}" y="${Math.max(15,y(settings.lossLimit)-7)}" text-anchor="end" class="limit-label">${pct(settings.lossLimit,0)} limit</text><polyline points="${points}" class="loss-line"/><line x1="${currentX}" x2="${currentX}" y1="${currentY}" y2="${H-bottom}" class="selected-guide"/><circle cx="${currentX}" cy="${currentY}" r="6" class="current-point"/>${ticks}</svg><span class="axis-caption">Extra exit discount →</span>`;
  const crossed = scenario.result.equityLossFraction >= settings.lossLimit;
  $("#critical").classList.toggle("crossed", crossed);
  $("#critical").innerHTML = `<span class="threshold-dot"></span><p><strong>${crossed ? "This scenario crosses your loss limit." : "This scenario stays within your loss limit."}</strong><span>${thresholdExitDiscount <= 1e-10 ? "The underlying shock alone reaches the selected limit." : `With this underlying shock, the limit is reached at ${pct(thresholdExitDiscount,2)} extra exit discount.`}</span></p>`;
}

function renderDecision(analysis) {
  const { decision } = analysis;
  if (decision.status === "unavailable") {
    $("#decision").innerHTML = `<tr><td colspan="4">Decision comparison withheld: ${esc(decision.reason)}</td></tr>`;
    $("#decision-summary").textContent = decision.limitation;
    $("#ranking").textContent = "";
    return;
  }
  const best = decision.expectedCostRanking?.[0];
  $("#decision").innerHTML = [decision.hold, ...decision.options].map((option) => {
    const threshold = option.id === "hold" ? "—" : option.breakEvenProbability === null ? "No loss to avoid" : option.breakEvenProbability > 1 ? "Above 100%" : pct(option.breakEvenProbability);
    return `<tr class="${best === option.id ? "preferred" : ""}"><th scope="row">${option.id === "hold" ? "Hold" : "Sell " + pct(option.exitFraction,0)}${best === option.id ? '<small>Lowest modelled cost</small>' : ""}</th><td>${money(option.executionCostUsd)}</td><td><span class="loss-amount">${money(option.residualConditionalLossUsd)}</span><span class="mini-bar"><i style="width:${(1-option.exitFraction)*100}%"></i></span></td><td>${threshold}</td></tr>`;
  }).join("");
  const quarter = decision.options.find((option)=>option.exitFraction===.25);
  $("#decision-summary").textContent = quarter?.breakEvenProbability !== null && quarter?.breakEvenProbability <= 1
    ? `Selling a quarter costs about ${money(quarter.executionCostUsd)} in this quote. It becomes cheaper than holding if you put the chance of this scenario above ${pct(quarter.breakEvenProbability)}.`
    : "At these inputs, a quoted sale may cost more than the loss it would avoid. Change the scenario to see where the comparison turns.";
  $("#probability-controls").hidden = !$("#use-probability").checked;
  $("#probability-value").textContent = $("#probability").value + "%";
  if (best) {
    const option = [decision.hold,...decision.options].find((item)=>item.id===best);
    $("#ranking").textContent = `At your ${$("#probability").value}% estimate, ${best === "hold" ? "holding" : "selling " + pct(option.exitFraction,0)} has the lowest modelled cost: ${money(option.expectedCostUsd)}. This omits the costs listed below.`;
  }
}

function updateAnalysis() {
  if (!packet) return;
  $("#underlying-value").textContent = Number($("#underlying").value).toFixed(2) + "%";
  $("#exit-value").textContent = Number($("#exit").value).toFixed(2) + "%";
  $("#loss-limit-value").textContent = $("#loss-limit").value + "%";
  currentAnalysis = analyzePacket(packet, parameters());
  const s = currentAnalysis.scenario, r = s.result, b = s.baseline;
  $("#economic-loss").textContent = pct(r.equityLossFraction);
  $("#economic-detail").textContent = money(r.equityLossUsd) + " of " + money(b.equityUsd) + " equity";
  $("#health-factor").textContent = r.healthFactor.toFixed(3);
  $("#health-detail").textContent = r.liquidationTriggered ? "Below the liquidation boundary" : "Above the 1.000 boundary";
  $("#formula").innerHTML = `<p>Reference collateral × (1 − underlying fall) × (1 − extra exit discount) − debt = shocked reference equity.</p><code>${money(b.exitValueUsd)} × ${(1-s.assumptions.underlyingHaircut).toFixed(4)} × ${(1-s.assumptions.exitDiscount).toFixed(4)} − ${money(b.debtUsd)} = ${money(r.economicEquityUsd)}</code><p>Health = PT quantity × oracle price in USDC × liquidation LTV ÷ debt in USDC. The oracle is held fixed for this instant shock.</p><p>Reference prices are not size-specific execution prices. All results on this page use snapshot ${esc(packet.snapshot.snapshotId)}.</p>`;
  renderMetrics(currentAnalysis); renderChart(currentAnalysis); renderDecision(currentAnalysis); renderInspector();
}

const evidenceTitles = {
  "settlement-chain": "Where the position lives", "yield-source": "What the PT depends on", "pt-underlying": "Which asset backs the PT",
  "pendle-exit-quote": "Quotes for three sale sizes", "morpho-oracle": "The lender’s quoted price", "oracle-architecture": "How the oracle is built",
  "morpho-collateral-rule": "The liquidation rule", "public-position-state": "The collateral and debt", "oracle-exit-tomography": "Market price versus oracle price"
};
function renderEvidence() {
  const snapshot = packet.snapshot;
  $("#evidence-meta").innerHTML = `<span>${snapshot.ledger.items.length} evidence items</span><span>Recorded ${esc(date(snapshot.observedAt))}</span><span title="${esc(snapshot.sha256)}">SHA-256 · ${esc(snapshot.sha256.slice(0,12))}…</span>`;
  $("#evidence").innerHTML = snapshot.ledger.items.map((item) => {
    let sources = [...item.sources];
    if (item.id === "oracle-architecture") sources = [{ provider: "Verified implementation", url: snapshot.rawInputs.oracleInvestigation.oracle.implementation.sourceUrl }, { provider: "Primary PT feed", url: snapshot.rawInputs.oracleInvestigation.feeds.pendleLinearDiscount.sourceUrl }];
    if (item.id === "pendle-exit-quote") sources = snapshot.rawInputs.exitQuotes.map((quote)=>({ provider: "Request " + pct(quote.fraction,0) + " quote again", url: item.sources[0].url + "?" + new URLSearchParams(quote.request) }));
    const legacyOracle = item.id === "morpho-oracle" ? (() => {
      const native = Number(snapshot.rawInputs.oracle.price) / 1e24;
      const debt = Number(snapshot.rawInputs.position.state.borrowAssets) / 1e6;
      const loanUsd = Number(snapshot.rawInputs.position.state.borrowAssetsUsd) / debt;
      return { oraclePriceLoan: native, loanUsd, oraclePriceUsd: native * loanUsd, note: "The on-chain oracle is PT priced in the loan asset. USD is a derived comparison value, not the native collateral-health unit." };
    })() : item.observation;
    const observation = legacyOracle ? `<details class="raw-evidence"><summary>Recorded values</summary><pre>${esc(JSON.stringify(legacyOracle,null,2))}</pre></details>` : "";
    return `<details class="evidence-item"><summary><span>${esc(evidenceTitles[item.id] ?? item.id)}</span><b class="evidence-kind ${esc(item.status)}">${item.status === "observed" ? "Observed" : "Calculated"}</b><span class="expand" aria-hidden="true">+</span></summary><div class="evidence-content"><p>${esc(item.claim)}</p>${item.inputs.length ? `<p class="inputs-list">Uses: ${item.inputs.map(esc).join(" · ")}</p>` : ""}${item.limitation ? `<p class="evidence-limit">${esc(item.limitation)}</p>` : ""}<div class="source-links">${sources.map((source)=>`<a href="${safeUrl(source.url)}" target="_blank" rel="noreferrer">${esc(source.provider)} ↗</a>`).join("")}</div>${observation}</div></details>`;
  }).join("");
}

function acceptPacket(next, mode) {
  // Calculate first. An incomplete refresh never replaces a working study.
  analyzePacket(next, parameters());
  packet = next; dataMode = mode;
  $("#app").hidden = false;
  renderHeader(); updateAnalysis(); renderMap(); renderEvidence();
}

async function requestPacket(endpoint) {
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
  const body = await response.json();
  if (!response.ok) { const error = new Error(body.detail || body.error); error.code = body.code; error.provider = body.provider; throw error; }
  return body.packet;
}

async function refreshLive() {
  if (refreshInFlight) return;
  refreshInFlight = true;
  $("#live-refresh").disabled = true;
  $("#live-refresh").innerHTML = '<span class="spinning" aria-hidden="true">↻</span> Reading sources…';
  setNotice("Checking Morpho, Pendle and the oracle contracts. You can keep exploring while this runs.", "loading");
  try {
    const next = await requestPacket("/api/live-analysis");
    acceptPacket(next, "live");
    setNotice("Updated. Every chart and quote now uses the same new capture.", "success");
  } catch (error) {
    const retained = packet ? (dataMode === "saved" ? "The saved case is still open, and the controls still work." : "Your last capture is still open, and the controls still work.") : "Try opening the saved case.";
    setNotice("Couldn’t get fresh data. " + retained, "warning", error.code === "NETWORK_ACCESS_BLOCKED" ? "This local server’s outbound network access is blocked. No new prices were loaded. Enable network access for the server, then retry." : error.message);
  } finally {
    refreshInFlight = false; $("#live-refresh").disabled = false;
    $("#live-refresh").innerHTML = '<span aria-hidden="true">↻</span> Refresh data';
  }
}

for (const element of Object.values(inputs)) element.addEventListener("input", updateAnalysis);
$("#probability").addEventListener("input", updateAnalysis);
$("#use-probability").addEventListener("change", updateAnalysis);
$("#reset").addEventListener("click", () => { $("#underlying").value = .5; $("#exit").value = 1; $("#loss-limit").value = 10; $("#use-probability").checked = false; updateAnalysis(); });
for (const button of document.querySelectorAll("[data-preset]")) button.addEventListener("click", () => { const [underlying,exit] = button.dataset.preset.split(","); $("#underlying").value=underlying; $("#exit").value=exit; updateAnalysis(); });
for (const button of document.querySelectorAll(".lens-tabs button[data-lens]")) button.addEventListener("click", () => {
  for (const tab of document.querySelectorAll(".lens-tabs button[data-lens]")) tab.setAttribute("aria-pressed", String(tab === button));
  $("#dependency-map").dataset.lens = button.dataset.lens;
});
$("#live-refresh").addEventListener("click", refreshLive);
$("#restore").addEventListener("click", () => { if (savedPacket) { acceptPacket(savedPacket,"saved"); setNotice(""); } });
$("#download").addEventListener("click", () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify({ ...packet, analysis: currentAnalysis, userScenario: parameters(), dataMode },null,2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = packet.snapshot.snapshotId + "-study.json"; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});
requestPacket("/api/demo-analysis").then((next) => { savedPacket = next; acceptPacket(next,"saved"); setNotice(""); }).catch((error)=>setNotice("The saved case could not be opened. Please restart the local server and reload this page.", "warning", error.message));

let chartWidth = 0;
new ResizeObserver(([entry]) => {
  const width = Math.round(entry.contentRect.width);
  if (currentAnalysis && width !== chartWidth) { chartWidth = width; renderChart(currentAnalysis); }
}).observe($("#loss-chart"));
compactMap.addEventListener("change", () => { if (packet) renderMap(); });

