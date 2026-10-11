import { decimalStringToNumber } from "./math.js";
import { SCHEMA } from "./portfolio-engine.js";

/** Converts the original evidence capture; no case-specific assumptions enter the general engine. */
export function fromCasePacket(packet) {
  const s=packet.snapshot,r=s.rawInputs,trace=r.oracleInvestigation;
  const qty=decimalStringToNumber(r.position.state.collateral,18);
  const debt=decimalStringToNumber(r.position.state.borrowAssets,6);
  const debtUsd=Number(r.position.state.borrowAssetsUsd),loanUsd=debtUsd/debt;
  const assetId=`${s.caseDefinition.chainId}:${r.market.collateral_token.toLowerCase()}`;
  const debtId=`${s.caseDefinition.chainId}:${r.market.loan_token.toLowerCase()}`;
  const evidence=s.ledger.items.map(e=>({id:e.id,claim:e.claim,status:e.status,sourceUrl:e.sources[0]?.url??null}));
  const dependencies=[
    {id:`chain:${s.caseDefinition.chainId}`,label:"Ethereum settlement",lens:"control",status:"observed",evidenceIds:["settlement-chain"]},
    {id:"protocol:ethena",label:"Ethena / sUSDe backing",lens:"value",status:"observed",evidenceIds:["yield-source","pt-underlying"]},
    {id:`token:${assetId}`,label:"PT-sUSDe reference value",lens:"value",status:"observed",evidenceIds:["pt-underlying"]},
    {id:`maturity:${s.caseDefinition.pendleMarket}`,label:"PT maturity and settlement",lens:"value",status:"inferred",evidenceIds:["yield-source","pt-underlying"]},
    {id:"ethena:reserves-and-hedges",label:"Ethena reserves and hedge operations",lens:"value",status:"unresolved",evidenceIds:[]},
    {id:`oracle:${trace.oracle.address.toLowerCase()}`,label:"Primary PT discount feed",lens:"liquidation",status:"observed",evidenceIds:["oracle-architecture"]},
    {id:`irm:${r.market.irm_address.toLowerCase()}`,label:"Morpho interest-rate model",lens:"liquidation",status:"inferred",evidenceIds:["morpho-collateral-rule"]},
    {id:`market:${s.caseDefinition.marketId}`,label:"Morpho collateral rule",lens:"liquidation",status:"observed",evidenceIds:["morpho-collateral-rule"]},
    {id:`pendle:${s.caseDefinition.pendleMarket}`,label:"Pendle PT → USDC route",lens:"exit",status:"observed",evidenceIds:["pendle-exit-quote"]},
    {id:`pendle-depth:${s.caseDefinition.pendleMarket}`,label:"Pendle liquidity and route depth",lens:"exit",status:"inferred",evidenceIds:["pendle-exit-quote"]},
    {id:`execution:${s.caseDefinition.position}`,label:"Approvals, aggregation and transaction ordering",lens:"exit",status:"unresolved",evidenceIds:[]},
    {id:`switch:${trace.oracle.address.toLowerCase()}`,label:"Oracle challenge and timelock",lens:"control",status:"observed",evidenceIds:["oracle-architecture"]},
    {id:"ethereum:blockspace-and-ordering",label:"Ethereum blockspace and transaction ordering",lens:"control",status:"inferred",evidenceIds:["settlement-chain"]},
    {id:"protocol:admin-controls",label:"Morpho, Pendle and Ethena pause or upgrade controls",lens:"control",status:"unresolved",evidenceIds:[]},
    {id:"ethena:offchain-controls",label:"Custody, exchange and hedge controls",lens:"control",status:"unresolved",evidenceIds:[]},
    {id:`unwind:${s.caseDefinition.marketId}`,label:"Fund repayment before withdrawal",lens:"exit",status:"inferred",evidenceIds:["public-position-state"]}
  ].map(d=>({...d,assetIds:[assetId]}));
  const position={id:s.snapshotId,label:"PT-sUSDe / USDC",protocol:"Morpho + Pendle",chainId:s.caseDefinition.chainId,kind:"collateralized-loan",origin:"observed",observedAt:s.observedAt,
    owner:s.caseDefinition.position,marketId:s.caseDefinition.marketId,sourceFingerprint:s.sha256,
    assets:[{id:assetId,symbol:"PT-sUSDe",role:"collateral",valueUsd:qty*Number(r.pendleSwap.ptToUnderlyingTokenRate)*Number(r.underlyingPrice.price),oracleValueUsd:qty*decimalStringToNumber(r.oracle.price,24)*loanUsd,liquidationThreshold:Number(r.market.lltv_wad)/1e18},
      {id:debtId,symbol:"USDC",role:"debt",valueUsd:debtUsd}],
    oracle:{mode:trace.oracle.isPrimary&&trace.conclusion.classification==="confirmed_static_primary_with_usde_aware_backup"?"fixed":"unknown",denomination:"loan",evidenceIds:["oracle-architecture"],backup:{challengeHours:trace.oracle.challengeTimelockSeconds/3600,description:"USDe/USD-aware backup; transition requires contract conditions and actions"}},
    evidence,dependencies,quotes:r.exitQuotes.map(q=>({fraction:q.fraction,proceedsUsd:decimalStringToNumber(q.output.amount,6)*loanUsd,minProceedsUsd:decimalStringToNumber(q.minTokenOut,6)*loanUsd,observedAt:s.observedAt,sourceUrl:"https://api-v2.pendle.finance/core/v2/sdk/1/convert?"+new URLSearchParams(q.request)}))};
  return {schemaVersion:SCHEMA,label:"Saved public case",positions:[position],scope:{complete:true,description:"One recorded public position, not a complete wallet scan."}};
}

export function comparisonExamples() {
  const observedAt="2026-10-10T00:00:00Z";
  const make=(id,label,kind,assets,mode)=>({id,label,kind,assets,protocol:"Illustrative model",chainId:1,origin:"illustrative",observedAt,
    oracle:{mode,evidenceIds:["assumptions"]},quotes:[],evidence:[{id:"assumptions",status:"assumed",claim:"Invented balances and pricing response for model comparison; not an observed address.",sourceUrl:null}],
    dependencies:assets.filter(a=>a.role!=="debt").map(a=>({id:`example:${a.id}`,label:a.symbol,lens:"value",status:"inferred",assetIds:[a.id],evidenceIds:["assumptions"]}))});
  return [make("example:spot","Unleveraged ETH · example","spot",[{id:"example-eth",symbol:"ETH",role:"holding",valueUsd:100000}],"none"),
    make("example:market-loan","ETH / USDC · example","collateralized-loan",[{id:"example-eth",symbol:"ETH",role:"collateral",valueUsd:100000,oracleValueUsd:100000,liquidationThreshold:.8},{id:"example-usdc",symbol:"USDC",role:"debt",valueUsd:60000}],"market")];
}
