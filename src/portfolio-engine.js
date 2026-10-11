/** Protocol-independent, conditional analysis. All monetary inputs are USD marks.
 * This model covers linear holdings and collateralized loans, not LP/option payoffs.
 * Pure module: shared by browser, API, and tests; never fetches or signs anything.
 */
export const SCHEMA = "fulcrum-portfolio/v1";
const kinds = new Set(["collateralized-loan", "spot", "supply"]);
const roles = new Set(["collateral", "holding", "debt"]);
const lenses = new Set(["value", "control", "liquidation", "exit"]);
const sum = (xs) => xs.reduce((a,b)=>a+b,0);
const number = (x) => typeof x === "number" && Number.isFinite(x);
function fraction(x, label) { if (!number(x) || x < 0 || x > 1) throw new Error(`${label} must be between 0 and 1.`); return x; }
function text(x, label) { if (typeof x !== "string" || !x.trim() || x.length > 2000) throw new Error(`${label} is missing or too long.`); }

export function validatePosition(p) {
  if (!p || typeof p !== "object") throw new Error("Position must be an object.");
  text(p.id,"Position ID"); text(p.label,"Position label"); text(p.kind,"Position kind");
  if (!Number.isFinite(Date.parse(p.observedAt))) throw new Error("Position needs an observation timestamp.");
  if (!Array.isArray(p.assets) || p.assets.length > 128) throw new Error("Provide at most 128 asset legs per position.");
  const ids = new Set();
  for (const a of p.assets) {
    text(a.id,"Asset ID"); text(a.symbol,"Asset symbol");
    if (ids.has(a.id)) throw new Error("Asset IDs must be unique within a position."); ids.add(a.id);
    if (!roles.has(a.role)) throw new Error("Unknown asset role.");
    if (a.valueUsd !== null && (!number(a.valueUsd) || a.valueUsd < 0 || a.valueUsd > 1e18)) throw new Error("Asset USD value must be between 0 and 1e18, or null if unknown.");
    if (a.oracleValueUsd != null && (!number(a.oracleValueUsd) || a.oracleValueUsd < 0)) throw new Error("Invalid oracle value.");
    if (a.liquidationThreshold != null) fraction(a.liquidationThreshold,"Liquidation threshold");
  }
  if (!p.oracle || !["fixed","market","unknown","none"].includes(p.oracle.mode)) throw new Error("Declare the oracle response, or mark it unknown.");
  if (p.oracle.denomination!=null && !["usd","loan"].includes(p.oracle.denomination)) throw new Error("Oracle denomination must be usd or loan.");
  if (!Array.isArray(p.evidence) || p.evidence.length > 512) throw new Error("Invalid evidence list.");
  const evidenceIds = new Set();
  for (const e of p.evidence) {
    text(e.id,"Evidence ID"); text(e.claim,"Evidence claim");
    if (evidenceIds.has(e.id)) throw new Error("Duplicate evidence ID."); evidenceIds.add(e.id);
    if (!["observed","derived","assumed"].includes(e.status)) throw new Error("Invalid evidence status.");
    if (e.status === "observed" && !/^https?:\/\//.test(e.sourceUrl ?? "")) throw new Error("Observed evidence requires a source URL.");
  }
  if ((p.oracle.evidenceIds??[]).some(id=>!evidenceIds.has(id))) throw new Error("Oracle references missing evidence.");
  if (["fixed","market"].includes(p.oracle.mode) && !p.oracle.evidenceIds?.length) throw new Error("A declared oracle response needs evidence or an explicit assumption record.");
  if (!Array.isArray(p.dependencies) || p.dependencies.length > 256) throw new Error("Invalid dependency list.");
  const dependencyIds = new Set();
  for (const d of p.dependencies) {
    text(d.id,"Dependency ID"); text(d.label,"Dependency label");
    if (dependencyIds.has(d.id)) throw new Error("Duplicate dependency ID."); dependencyIds.add(d.id);
    if (!lenses.has(d.lens) || !["observed","inferred","unresolved"].includes(d.status)) throw new Error("Invalid dependency classification.");
    if (!Array.isArray(d.assetIds) || d.assetIds.some(id=>!ids.has(id))) throw new Error("Dependency references an unknown asset.");
    if (!Array.isArray(d.evidenceIds) || d.evidenceIds.some(id=>!evidenceIds.has(id))) throw new Error("Dependency references missing evidence.");
    if (d.status === "observed" && !d.evidenceIds.length) throw new Error("Observed dependency requires evidence.");
  }
  if (!Array.isArray(p.quotes) || p.quotes.length > 32) throw new Error("Invalid quote list.");
  const fractions = new Set();
  for (const q of p.quotes) {
    fraction(q.fraction,"Sale fraction");
    if (!q.fraction || fractions.has(q.fraction)) throw new Error("Quote fractions must be positive and unique."); fractions.add(q.fraction);
    if (!number(q.proceedsUsd) || q.proceedsUsd < 0 || (q.minProceedsUsd!==undefined&&(!number(q.minProceedsUsd)||q.minProceedsUsd<0||q.minProceedsUsd>q.proceedsUsd))) throw new Error("Quote proceeds or recorded minimum are invalid.");
    if (!Number.isFinite(Date.parse(q.observedAt)) || !/^https?:\/\//.test(q.sourceUrl ?? "")) throw new Error("Quotes need a timestamp and source URL.");
  }
  return p;
}

export function validatePortfolio(portfolio) {
  if (portfolio?.schemaVersion !== SCHEMA || !Array.isArray(portfolio.positions) || portfolio.positions.length > 1000) throw new Error("Expected fulcrum-portfolio/v1 with at most 1,000 positions.");
  const ids = new Set();
  for (const p of portfolio.positions) { text(p?.id,"Position ID"); if (ids.has(p.id)) throw new Error(`Duplicate position: ${p.id}`); ids.add(p.id); }
  return portfolio;
}

function settings(s={}) {
  const out={underlyingDrop:.005,exitDiscount:.01,debtRise:0,lossLimit:.1,...s};
  for (const key of ["underlyingDrop","exitDiscount","debtRise","lossLimit"]) fraction(out[key],key);
  if (out.backupDrop != null) fraction(out.backupDrop,"Backup price fall");
  return out;
}

export function evaluatePosition(p, scenario={}) {
  const s=settings(scenario);
  try { validatePosition(p); } catch (error) { return {id:p?.id,label:p?.label,status:"blocked",reason:error.message}; }
  if (!kinds.has(p.kind)) return {id:p.id,label:p.label,status:"unsupported",reason:`${p.kind} needs a payoff adapter. No linear risk number has been substituted.`};
  if (!p.assets.length || p.assets.some(a=>a.valueUsd===null)) return {id:p.id,label:p.label,status:"blocked",reason:"Missing asset valuations; totals and losses are withheld."};
  if (p.kind!=="collateralized-loan" && p.assets.some(a=>a.role==="debt")) return {id:p.id,label:p.label,status:"blocked",reason:"Debt requires a collateralized-loan model."};
  const assets=p.assets.filter(a=>a.role!=="debt"), debts=p.assets.filter(a=>a.role==="debt");
  const c=sum(assets.map(a=>a.valueUsd)),d=sum(debts.map(a=>a.valueUsd)),equity=c-d;
  const dependency=s.dependencyId ? p.dependencies.find(x=>x.id===s.dependencyId) : null;
  // A selected dependency shock acts only on its named asset legs. Access failure
  // is not silently converted to a dollar loss; only value-lens dependencies apply.
  const affected=(a)=>!s.dependencyId || (dependency?.lens==="value" && dependency.assetIds.includes(a.id));
  const legs=assets.map(a=>({id:a.id,valueUsd:a.valueUsd,underlyingDrop:affected(a)?s.underlyingDrop:0,exitDiscount:s.exitDiscount}));
  const after=sum(legs.map(a=>a.valueUsd*(1-a.underlyingDrop)*(1-a.exitDiscount)));
  const debtAfter=d*(1+s.debtRise),loss=c-after+debtAfter-d;
  const capacities=assets.filter(a=>a.role==="collateral");
  const capacityKnown=capacities.length>0 && capacities.every(a=>number(a.oracleValueUsd)&&number(a.liquidationThreshold));
  const capacity=capacityKnown?sum(capacities.map(a=>a.oracleValueUsd*a.liquidationThreshold)):null;
  const baseHealth=d===0?null:capacity===null?null:capacity/d;
  const mode=p.oracle.mode;
  let health=null,healthRange=null;
  if(d>0 && capacityKnown) {
    const marketCapacity=sum(capacities.map(a=>a.oracleValueUsd*a.liquidationThreshold*(1-(affected(a)?s.underlyingDrop:0))*(1-s.exitDiscount)));
    // A frozen collateral/loan quote also changes its USD value when the loan
    // token reprices. Do not falsely change native loan health through USD marks.
    const fixedCapacity=capacity*(p.oracle.denomination==="loan"?1+s.debtRise:1);
    if (s.assumeBackup && p.oracle.backup) health=fixedCapacity*(1-(s.backupDrop??0))/debtAfter;
    else if (mode==="fixed") health=fixedCapacity/debtAfter;
    else if (mode==="market") health=marketCapacity/debtAfter;
    else healthRange=[marketCapacity/debtAfter,fixedCapacity/debtAfter];
  }
  const beforeExit=sum(legs.map(a=>a.valueUsd*(1-a.underlyingDrop)));
  const requiredValue=(1-s.lossLimit)*equity+debtAfter;
  const exitBoundary=equity>0 && beforeExit>0 ? Math.max(0,1-requiredValue/beforeExit):null;
  // Closest joint shock in the L-infinity norm: min max(underlying, exit),
  // with equal monotone shocks on all assets and debt held at this scenario's mark.
  const jointThreshold=equity>0&&c>0&&!s.dependencyId?Math.max(0,1-Math.sqrt(Math.max(0,(c-s.lossLimit*equity+d*s.debtRise)/c))):null;
  return {id:p.id,label:p.label,status:"modelled",assetsUsd:c,debtUsd:d,equityUsd:equity,shockedAssetsUsd:after,shockedEquityUsd:after-debtAfter,
    lossUsd:loss,lossFraction:equity>0?loss/equity:null,baselineHealth:baseHealth,health,healthRange,capacityUsd:capacity,
    liquidation:health===null?"unknown":health<1?"eligible":"above-boundary",exitBoundary,jointThreshold,
    attribution:{underlying:sum(legs.map(a=>a.valueUsd*a.underlyingDrop*(1-a.exitDiscount/2))),exit:sum(legs.map(a=>a.valueUsd*a.exitDiscount*(1-a.underlyingDrop/2))),debt:d*s.debtRise},
    warnings:[...(equity<=0?["Nonpositive equity: percentage loss and reverse stress are undefined."]:[]),...(mode==="unknown"&&d>0?["Oracle response unknown. The displayed range compares fixed and market-following assumptions; it is not a guaranteed bound."]:[]),...(s.assumeBackup?["Backup activation and its price change are user assumptions, not a forecast."]:[]),"Instant mark-to-market model. Interest, liquidation penalties, redemption queues and execution costs are excluded."]};
}

export function buildInvestigation(p) {
  const known=p.oracle.mode!=="unknown"&&p.oracle.mode!=="none";
  const traced=p.origin==="observed"&&(p.oracle.evidenceIds??[]).some(id=>p.evidence.find(e=>e.id===id)?.status==="observed");
  return [
    {question:"Does the lender follow the sale price?", verdict:p.kind!=="collateralized-loan"?"Not a loan":p.oracle.mode==="fixed"?(traced?"Contract evidence supports fixed pricing":"Fixed-price assumption supplied"):p.oracle.mode==="market"?"Market-following model supplied":"Unresolved",
      competing:["A fixed or independently computed price","A market-following price","An unclassified or changing route"],
      evidenceIds:p.oracle.evidenceIds??[],method:known?"Inspect the supplied oracle evidence and its scope.":"Trace the deployed oracle, its inputs and active branch. Price correlation alone cannot identify the route."},
    {question:"Can the recorded assets actually be sold?",verdict:p.quotes.length?"Sale quotes recorded; loan unwind unproved":"No sized sale quote",
      competing:["Quoted route remains executable","Insufficient depth, approvals or available collateral"],evidenceIds:[],method:"A price mark is not a sale quote. A quote is not a completed withdrawal and repayment."},
    {question:"Who can change or block the route?",verdict:p.dependencies.some(d=>d.lens==="control"&&d.status==="observed")?"Some controls documented":"Control coverage incomplete",
      competing:["Documented controls and delays","Untraced administrators or off-chain dependencies"],evidenceIds:p.dependencies.filter(d=>d.lens==="control").flatMap(d=>d.evidenceIds),method:"Inspect upgrade, pause, custody and withdrawal controls. Missing edges remain unknown."}
  ];
}

export function buildTimeline(p,scenario={}) {
  const s=settings(scenario);
  const stages=[
    {name:"Recorded position",assumption:"Snapshot marks; no shock.",shock:{...s,underlyingDrop:0,exitDiscount:0,debtRise:0,assumeBackup:false}},
    {name:"Underlying reprices",assumption:"Apply the selected underlying and debt-price changes.",shock:{...s,exitDiscount:0,assumeBackup:false}},
    {name:"Sale price worsens",assumption:"Add the extra exit discount. No time or probability is implied.",shock:{...s,assumeBackup:false}}
  ];
  if(p.oracle.backup) stages.push({name:"Backup branch",assumption:s.assumeBackup?`Assume the switch has occurred and its price falls ${((s.backupDrop??0)*100).toFixed(1)}%. The documented ${p.oracle.backup.challengeHours ?? "unknown"}-hour challenge delay does not guarantee activation.`:"Inactive counterfactual. Enable the backup assumption to calculate it.",shock:s.assumeBackup?s:null});
  return stages.map(stage=>({...stage,result:stage.shock?evaluatePosition(p,stage.shock):null}));
}

export function rehearseExit(p,{fraction:part=.25,cashUsd=0,gasUsd=null,fundingFeeUsd=null,targetHealth=1.05,atomic=false,now=Date.now()}={}) {
  fraction(part,"Exit fraction");
  if (!part || !number(cashUsd)||cashUsd<0 || !number(targetHealth)||targetHealth<1) throw new Error("Invalid funding or target health.");
  for(const x of [gasUsd,fundingFeeUsd]) if(x!==null&&(!number(x)||x<0)) throw new Error("Costs must be nonnegative or left unknown.");
  const b=evaluatePosition(p,{underlyingDrop:0,exitDiscount:0});
  if(b.status!=="modelled") return {status:"blocked",blockers:[b.reason],steps:[]};
  const q=p.quotes.find(q=>Math.abs(q.fraction-part)<1e-9);
  const blockers=[];
  if(!q) blockers.push("No quote for exactly this fraction. Smaller quotes are not scaled up.");
  if(b.debtUsd>0&&b.capacityUsd===null) blockers.push("Oracle collateral value or liquidation threshold is missing.");
  if(b.baselineHealth!==null&&b.baselineHealth<1) blockers.push("The recorded loan is already liquidation-eligible; this voluntary exit model is insufficient.");
  const minRepay=b.debtUsd===0?0:b.capacityUsd===null?null:Math.max(0,b.debtUsd-(1-part)*b.capacityUsd/targetHealth);
  const repayment=minRepay===null?null:Math.max(part*b.debtUsd,minRepay);
  const shortfall=repayment===null?null:Math.max(0,repayment-cashUsd);
  if(shortfall>0&&!atomic) blockers.push("Declared cash is below the repayment needed before withdrawing collateral.");
  if(atomic) blockers.push("Atomic funding and the complete transaction route have not been simulated on a fork.");
  const proceeds=q?.proceedsUsd??null;
  const minimumProceeds=q?.minProceedsUsd??null;
  const net=proceeds===null||repayment===null?null:proceeds-repayment;
  const minimumNet=minimumProceeds===null||repayment===null?null:minimumProceeds-repayment;
  const fullyCosted=gasUsd!==null&&fundingFeeUsd!==null;
  if(net!==null&&fullyCosted&&net-gasUsd-fundingFeeUsd<0) blockers.push("Sale proceeds do not cover the modelled repayment and entered costs.");
  const age=q?Math.max(0,(now-Date.parse(q.observedAt))/60000):null;
  return {status:blockers.length?"blocked":"arithmetic-only",blockers,repaymentUsd:repayment,minRepaymentUsd:minRepay,fundingShortfallUsd:shortfall,
    proceedsUsd:proceeds,minimumProceedsUsd:minimumProceeds,netBeforeUnpricedCostsUsd:net,minimumNetBeforeUnpricedCostsUsd:minimumNet,netAfterEnteredCostsUsd:fullyCosted&&net!==null?net-gasUsd-fundingFeeUsd:null,quoteAgeMinutes:age,
    remainingDebtUsd:repayment===null?null:b.debtUsd-repayment,
    remainingHealth:repayment===null||b.debtUsd-repayment<=1e-8?null:(1-part)*b.capacityUsd/(b.debtUsd-repayment),
    steps:[{name:"Fund repayment",amount:repayment,note:atomic?"Unverified atomic funding hypothesis":"Use declared external cash before collateral is released"},
      {name:"Repay the loan",amount:repayment,note:"Repay at least the proportional debt or the amount required by the target health"},
      {name:"Withdraw collateral",amount:b.assetsUsd*part,note:`Withdraw ${(part*100).toFixed(0)}% proportionally; approvals and protocol permissions need verification`},
      {name:"Sell the released assets",amount:proceeds,note:q?"Recorded sized quote; refresh and simulate before use":"Blocked: no matching quote"},
      {name:"Settle funding and costs",amount:net,note:"Net proceeds after modelled repayment; gas and financing remain separate"}],
    limitations:["A funding rehearsal at recorded prices, not transaction execution or a liquidation simulation.","Quote age is shown; no recorded quote is promised to remain fillable.","Repayment rounding, token approvals, flash liquidity, pause state and transaction ordering need a protocol-specific fork test."]};
}

export function evidenceGaps(p,result) {
  const gaps=[];
  const add=(priority,title,action,impact)=>gaps.push({priority,title,action,impact});
  if(result.status!=="modelled") add(0,"Position cannot be priced",result.reason,"Portfolio totals exclude this position.");
  if(p.oracle?.mode==="unknown"&&p.kind==="collateralized-loan") add(1,"Oracle response is unclassified","Trace the deployed feed and active branch.","Whether a price shock can trigger liquidation remains unresolved.");
  if(!p.quotes?.length) add(1,"No sized exit quote","Obtain a quote for each intended sale size.","Exit cost and sale proceeds cannot be calculated.");
  if(p.kind==="collateralized-loan") add(1,"Complete loan unwind is unverified","Simulate repay → withdraw → sell with funding, approvals and fees on a fork.","A sale quote does not prove the pledged collateral can be accessed.");
  if(!p.dependencies?.some(d=>d.lens==="control"&&d.status==="observed")||p.dependencies.some(d=>d.lens==="control"&&d.status!=="observed")) add(2,"Control dependencies are incomplete","Identify pause, upgrade, custody and redemption controls.","A route may be blocked even when the price looks healthy.");
  if(p.origin==="imported") add(2,"Imported claims have not been independently verified","Check the source links, units and timestamps.","Analysis is conditional on the supplied evidence.");
  add(3,"No event probability or time model","Calibrate with a justified historical or structural model if probabilities are required.","Losses are conditional scenarios, not a forecast or VaR.");
  return gaps.sort((a,b)=>a.priority-b.priority);
}

export function evaluatePortfolio(portfolio,scenario={}) {
  validatePortfolio(portfolio); settings(scenario);
  const rows=portfolio.positions.map(p=>evaluatePosition(p,scenario));
  const positionsById=new Map(portfolio.positions.map(p=>[p.id,p]));
  const resultsById=new Map(rows.map(r=>[r.id,r]));
  const modelled=rows.filter(r=>r.status==="modelled");
  const actual=modelled.filter(r=>positionsById.get(r.id).origin!=="illustrative");
  const shared=new Map();
  for(const p of portfolio.positions) {
    if(p.origin==="illustrative"||resultsById.get(p.id)?.status!=="modelled") continue;
    for(const dep of p.dependencies) {
      let entry=shared.get(dep.id);
      if(!entry) {entry={id:dep.id,label:dep.label,lens:dep.lens,positionIds:[],exposedAssetsUsd:0};shared.set(dep.id,entry);}
      entry.positionIds.push(p.id);
      entry.exposedAssetsUsd+=sum(p.assets.filter(a=>dep.assetIds.includes(a.id)&&a.role!=="debt").map(a=>a.valueUsd));
    }
  }
  const actualCount=portfolio.positions.filter(p=>p.origin!=="illustrative").length;
  const equity=sum(actual.map(r=>r.equityUsd)),loss=sum(actual.map(r=>r.lossUsd));
  return {rows,totalPositions:portfolio.positions.length,evaluated:modelled.length,actualCount,actualEvaluated:actual.length,
    totals:{assetsUsd:sum(actual.map(r=>r.assetsUsd)),debtUsd:sum(actual.map(r=>r.debtUsd)),equityUsd:equity,lossUsd:loss,lossFraction:equity>0?loss/equity:null},
    partial:actual.length!==actualCount,shared:[...shared.values()].filter(d=>d.positionIds.length>1).sort((a,b)=>b.exposedAssetsUsd-a.exposedAssetsUsd),
    limitations:["Illustrative examples are excluded from totals and shared exposures.","Totals cover supplied positions only. A shared dependency is exposure, not a probability or correlation estimate.","Dependency exposures overlap and must not be added together."]};
}
