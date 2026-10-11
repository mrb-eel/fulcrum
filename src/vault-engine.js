/** Economic stress of a lender's claim. No collateral haircut is applied directly
 * to a vault share. Borrower shortfalls pass through market supply shares first.
 * Amounts are in the loan token; USD is a display conversion. */
import { lookupToken, pegSight, familySight, liquidationIncentive } from './registry.js';
import { relativeSeries, eventFrequency } from './base-rates.js';

const sum=xs=>xs.reduce((a,b)=>a+b,0);
const ZERO='0x'+'0'.repeat(40);
const address=x=>{if(!/^0x[\da-f]{40}$/i.test(x??''))throw new Error('Invalid contract address.');return x.toLowerCase();};
function uint(x){if(typeof x==='number'&&!Number.isSafeInteger(x))throw new Error('Unsafe integer in source data.');if(!/^\d+$/.test(String(x)))throw new Error('Invalid unsigned integer.');return BigInt(x);}
const units=(x,d)=>{const n=uint(x),base=10n**BigInt(d);return Number(n/base)+Number(n%base)/Number(base);};
const frac=(x,label)=>{if(!Number.isFinite(x)||x<0||x>1)throw new Error(`${label} must be between 0 and 1.`);return x;};
const positive=(x,label)=>{if(!Number.isFinite(x)||x<=0||x>1e15)throw new Error(`${label} must be positive and finite.`);return x;};
const short=a=>`${a.slice(0,6)}…${a.slice(-4)}`;
const ROLES=['BASE_FEED_1','BASE_FEED_2','QUOTE_FEED_1','QUOTE_FEED_2'];
const INDEXER_ROLES={baseFeedOne:'BASE_FEED_1',baseFeedTwo:'BASE_FEED_2',quoteFeedOne:'QUOTE_FEED_1',quoteFeedTwo:'QUOTE_FEED_2'};
export const INCIDENTS=['collateral-decline','price-fall','depeg','feed-freeze','withdrawal-freeze'];
// Exit transaction gas, an explicit assumption: a multi-market MetaMorpho withdrawal plus a later re-deposit.
export const EXIT_GAS_UNITS={withdraw:400_000,reenter:250_000};

/** Oracle inputs: on-chain reads at the pinned enrichment block when available, otherwise the indexer. */
function oracleView(oracle,enrichment){
  const addr=oracle?.address?address(oracle.address):null;
  if(!addr||addr===ZERO)return null;
  const e=enrichment?.snapshot,onchain=e?.oracles?.[addr];
  const indexerFeeds=Object.entries(oracle.data??{}).filter(([k,f])=>INDEXER_ROLES[k]&&f?.address&&address(f.address)!==ZERO).map(([k,f])=>({role:INDEXER_ROLES[k],address:address(f.address)}));
  const indexerVault=oracle.data?.baseOracleVault?.address&&address(oracle.data.baseOracleVault.address)!==ZERO?address(oracle.data.baseOracleVault.address):null;
  if(onchain?.kind==='morpho-chainlink'){
    const inputs=ROLES.filter(r=>onchain[r]).map(r=>({role:r,address:onchain[r],description:e.feeds?.[onchain[r]]?.description??null,value:e.feeds?.[onchain[r]]?.value??null,updatedAt:e.feeds?.[onchain[r]]?.updatedAt??null}));
    const vault=onchain.BASE_VAULT?{address:onchain.BASE_VAULT,symbol:e.conversionVaults?.[onchain.BASE_VAULT]?.symbol??null}:null;
    const same=oracle.data?JSON.stringify(indexerFeeds.map(f=>f.role+f.address).sort())===JSON.stringify(inputs.map(f=>f.role+f.address).sort())&&(indexerVault??null)===(vault?.address??null):null;
    return {address:addr,type:oracle.type,kind:'morpho-chainlink',source:'on-chain',block:e.block.number,inputs,vault,verification:same==null?'on-chain only':same?'indexer matches on-chain':'indexer differs from on-chain'};
  }
  if(onchain?.kind==='unreadable')return {address:addr,type:oracle.type,kind:'unreadable',source:'on-chain',block:e.block.number,inputs:[],vault:null,verification:'not a Morpho Chainlink oracle; implementation not traced'};
  if(oracle.data)return {address:addr,type:oracle.type,kind:'indexer',source:'indexer',inputs:indexerFeeds.map(f=>({...f,description:null})),vault:indexerVault?{address:indexerVault,symbol:null}:null,verification:'indexer only'};
  return {address:addr,type:oracle.type,kind:'unreadable',source:'indexer',inputs:[],vault:null,verification:'no composition in indexer'};
}

export function buildVaultModel(packet, {enrichment=null,history=null}={}) {
  const s=packet?.snapshot,v=s?.vault,vs=v?.state;
  if(s?.schemaVersion!=='fulcrum-vault-evidence/v1'||!vs||!Number.isFinite(Date.parse(s.capturedAt)))throw new Error('Invalid vault evidence packet.');
  if(address(s.address)!==address(v.address)||v.chain.id!==s.chainId)throw new Error('Vault identity mismatch.');
  const decimals=v.asset.decimals;
  if(!Number.isInteger(decimals)||decimals<0||decimals>36)throw new Error('Invalid asset decimals.');
  const total=positive(units(vs.totalAssets,decimals),'Vault assets'),usdPrice=positive(vs.totalAssetsUsd/total,'USD reference price');
  const loanToken=s.chainId===1?lookupToken(v.asset.address,v.asset.symbol):null,loanFamily=loanToken?.family??null;
  const nodes=new Map(),edges=[],dependencies=new Map(),markets=[],warnings=[...(s.warnings??[])];
  const node=(id,label,kind,status='observed',extra={})=>{if(!nodes.has(id))nodes.set(id,{id,label,kind,status,...extra});return id;};
  const edge=(from,to,relation)=>edges.push({from,to,relation});
  const root=node(`vault:${s.chainId}:${address(v.address)}`,v.name,'vault');
  function dependency(id,label,kind,marketId,status='observed',extra={}) {
    if(!dependencies.has(id))dependencies.set(id,{id,label,kind,status,marketIds:[],...extra});
    const d=dependencies.get(id);if(!d.marketIds.includes(marketId))d.marketIds.push(marketId);
    node(id,label,kind,status,extra);return id;
  }
  const protocol=node('protocol:morpho-blue','Morpho Blue core contract','protocol');edge(root,protocol,'lends through');
  const ids=new Set();let unknownOracleCount=0,mismatches=0;
  for(const a of vs.allocation){
    const allocated=units(a.supplyAssets,decimals);if(!allocated)continue;
    const m=a.market,ms=m.state,id=m.marketId;
    if(!/^0x[\da-f]{64}$/i.test(id)||ids.has(id))throw new Error('Duplicate or invalid market.');ids.add(id);
    if(address(m.loanAsset.address)!==address(v.asset.address)||m.loanAsset.decimals!==decimals)throw new Error('Market loan asset does not match vault.');
    const supply=positive(units(ms.supplyAssets,decimals),'Market supply'),borrow=units(ms.borrowAssets,decimals),liquidity=units(ms.liquidityAssets,decimals);
    if(borrow>supply+1/10**decimals || allocated>supply+1/10**decimals)throw new Error('Inconsistent market balance.');
    if(Math.abs(liquidity-(supply-borrow))>Math.max(1e-5,supply*1e-8))throw new Error('Market liquidity does not reconcile.');
    const lltv=frac(Number(uint(m.lltv))/1e18,'LLTV'),collateral=m.collateralAsset;
    const token=collateral&&s.chainId===1?lookupToken(collateral.address,collateral.symbol):null;
    const view=oracleView(m.oracle,enrichment);
    if(view?.verification==='indexer differs from on-chain'){mismatches++;warnings.push(`${collateral?.symbol??'Idle'} market ${id.slice(0,10)}: the indexer's oracle composition differs from the on-chain read; the on-chain read is used.`);}
    if(view&&view.kind==='unreadable')unknownOracleCount++;
    const sight={peg:collateral?pegSight(token,view):{state:'n/a',reason:'No collateral.'},family:collateral?familySight(token?.family,view):{state:'n/a',reason:'No collateral.'}};
    const marketNode=node(`market:${id}`,`${collateral?.symbol??'Idle'} / ${v.asset.symbol} · ${(lltv*100).toFixed(1)}% LLTV`,'market');edge(root,marketNode,'supplies');edge(marketNode,protocol,'runs on');
    dependency(marketNode,`${collateral?.symbol??'Idle'} market · ${(lltv*100).toFixed(1)}% LLTV · ${id.slice(0,8)}`,'market',id);
    dependency('protocol:morpho-blue','Morpho Blue core contract','protocol',id);
    if(collateral){
      const tokenId=dependency(`token:${s.chainId}:${address(collateral.address)}`,collateral.symbol,'collateral',id,'observed',{symbol:collateral.symbol});edge(marketNode,tokenId,'secured by');
      if(token?.family&&token.family!==loanFamily&&['BTC','ETH','XAU','EUR','EQUITY'].includes(token.family)){const f=dependency(`family:${token.family}`,`${token.family} price`,'family',id,'curated');edge(tokenId,f,'priced in');}
      if(token){const iss=dependency(`issuer:${token.issuer}`,token.issuer,'issuer',id,'curated',{role:token.role,source:token.source});edge(tokenId,iss,token.role);}
      if(['rate','none'].includes(sight.peg.state)){const b=dependency(`blind:${token.symbol}`,`Oracle can't see ${token.link}`,'blindspot',id,'observed',{reason:sight.peg.reason});edge(tokenId,b,'oracle blind spot');}
    }
    if(view){
      const oid=dependency(`oracle:${s.chainId}:${view.address}`,`Oracle ${short(view.address)}`,'oracle',id);edge(marketNode,oid,'priced by');
      for(const input of view.inputs){const fid=dependency(`feed:${s.chainId}:${input.address}`,input.description?`${input.description}`:`Feed ${short(input.address)}`,'feed',id,'observed',{address:input.address,description:input.description});edge(oid,fid,input.role);}
      if(view.vault){const vid=dependency(`oracle-vault:${s.chainId}:${view.vault.address}`,`${view.vault.symbol??'Vault'} conversion rate`,'oracle-vault',id);edge(oid,vid,'BASE_VAULT');}
    }
    const raw=s.borrowers[id];if(!raw||!Array.isArray(raw.items))throw new Error('Missing borrower coverage record.');
    const seen=new Set(),borrowers=[];let scannedShares=0n;
    const totalShares=uint(ms.borrowShares),totalBorrow=uint(ms.borrowAssets);
    const collateralUnits=ms.collateralAssets==null?null:units(ms.collateralAssets,collateral?.decimals??18);
    const unitValue=collateralUnits>0&&Number.isFinite(ms.collateralAssetsUsd)&&ms.collateralAssetsUsd>=0?ms.collateralAssetsUsd/usdPrice/collateralUnits:null;
    for(const row of raw.items){
      const who=address(row.user.address);if(seen.has(who)||row.market.marketId!==id)throw new Error('Duplicate borrower or market mismatch.');seen.add(who);
      const shares=uint(row.state.borrowShares);scannedShares+=shares;
      // Morpho virtual shares = 1e6 and virtual assets = 1; round debt up.
      const debtRaw=(shares*(totalBorrow+1n)+(totalShares+1000000n)-1n)/(totalShares+1000000n);
      const debt=units(debtRaw,decimals),quantity=units(row.state.collateral,collateral?.decimals??18);
      const oracleValue=ms.price==null?null:units(uint(row.state.collateral)*uint(ms.price)/10n**36n,decimals);
      const economicValue=quantity===0?0:unitValue==null?null:quantity*unitValue;
      borrowers.push({address:who,debt,oracleValue,economicValue,timestamp:Number(row.state.timestamp)});
      const bid=dependency(`borrower:${s.chainId}:${who}`,`Borrower ${who.slice(0,8)}`,'borrower',id);edge(marketNode,bid,'lends to');
    }
    if(scannedShares>totalShares)throw new Error('Borrower shares exceed market total: observations are inconsistent; recapture.');
    const coveredDebt=Math.min(borrow,sum(borrowers.map(b=>b.debt))),missingDebt=Math.max(0,borrow-coveredDebt);
    if(!raw.complete||scannedShares!==totalShares)warnings.push(`Borrower coverage incomplete for ${id}; missing debt receives a 0–100% loss range.`);
    markets.push({id,label:collateral?.symbol??'Idle',collateralAddress:collateral?.address??null,allocated,weight:allocated/total,supply,borrow,liquidity,
      withdrawQueueIndex:a.withdrawQueueIndex,withdrawable:a.withdrawQueueIndex==null?0:Math.min(allocated,liquidity),
      supplyFraction:allocated/supply,lltv,lif:liquidationIncentive(lltv),borrowers,missingDebt,complete:raw.complete&&scannedShares===totalShares,
      pricedDebt:sum(borrowers.filter(b=>b.economicValue!=null).map(b=>b.debt)),oracle:view,token:token?{symbol:token.symbol,family:token.family,kind:token.kind,issuer:token.issuer,role:token.role,link:token.link,source:token.source}:null,sight,
      block:Number(ms.blockNumber),timestamp:Number(ms.timestamp)});
  }
  const allocated=sum(markets.map(m=>m.allocated)),residual=total-allocated;
  if(Math.abs(residual)>Math.max(.01,total*1e-6))warnings.push('Vault total and listed market allocations differ; residual is untraced and is not assumed withdrawable.');
  if(residual < -Math.max(.01,total*1e-6))throw new Error('Allocations exceed vault total: observations do not reconcile.');
  // A positive residual is NOT silently called idle cash without a balance read.
  const unresolvedAssets=Math.max(0,residual),queueLiquidity=sum(markets.map(m=>m.withdrawable));
  if(unknownOracleCount)warnings.push(`${unknownOracleCount} market oracle${unknownOracleCount>1?'s':''} could not be decoded; their response to an incident is an assumption.`);
  const chain=node(`chain:${s.chainId}`,s.chainId===1?'Ethereum mainnet':`Chain ${s.chainId}`,'chain');edge(root,chain,'settles on');
  const loan=node(`loan:${s.chainId}:${address(v.asset.address)}`,v.asset.symbol,'loan-asset');edge(root,loan,'denominated in');
  if(loanToken){const iss=node(`issuer:${loanToken.issuer}`,loanToken.issuer,'issuer','curated',{role:loanToken.role,source:loanToken.source});edge(loan,iss,loanToken.role);}
  for(const role of ['owner','curator','guardian'])if(vs[role]&&address(vs[role])!==ZERO)edge(root,node(`controller:${address(vs[role])}`,`${role} ${short(vs[role])}`,'controller'),role);
  const deps=[...dependencies.values()].map(d=>({...d,
    exposure:sum(markets.filter(m=>d.marketIds.includes(m.id)).map(m=>d.kind==='borrower'?sum(m.borrowers.filter(b=>b.address===d.id.split(':').at(-1)).map(b=>b.debt))*m.supplyFraction:m.allocated)),
    exposureBasis:d.kind==='borrower'?'Vault share of this borrower’s debt':'Union of vault allocations in connected markets'
  })).sort((a,b)=>b.exposure-a.exposure);
  const times=markets.map(m=>m.timestamp).concat(Number(vs.timestamp));
  const ageSeconds=Math.max(0,(Date.parse(s.capturedAt)/1000)-Math.min(...times));
  if(ageSeconds>3600)warnings.push(`Indexer observations predate capture by up to ${(ageSeconds/3600).toFixed(1)} hours; this is saved evidence, not a current executable quote.`);
  const e=enrichment?.snapshot;
  return {snapshotId:packet.snapshotId,capturedAt:s.capturedAt,name:v.name,address:v.address,chainId:s.chainId,asset:v.asset,loanToken,loanFamily,total,usdPrice,allocated,unresolvedAssets,
    queueLiquidity,reportedLiquidity:units(v.liquidity?.underlying??0,decimals),markets,dependencies:deps,graph:{nodes:[...nodes.values()],edges,
      provenance:{snapshotId:packet.snapshotId,enrichmentId:enrichment?.snapshotId??null,sourceUrl:'https://api.morpho.org/graphql',capturedAt:s.capturedAt,observation:e?`Indexer-reported markets and borrowers; oracle inputs read on-chain at block ${e.block.number}. Issuer, family and blind-spot nodes use a curated registry.`:'Indexer-reported connections; family nodes use a curated address registry. No independent RPC verification.'}},warnings,
    timelockSeconds:Number(vs.timelock),factory:v.factory.address,owner:vs.owner??null,curator:vs.curator??null,netApy:Number.isFinite(vs.netApy)?vs.netApy:null,apy:Number.isFinite(vs.apy)?vs.apy:null,fee:Number.isFinite(vs.fee)?vs.fee:null,
    borrowerCount:sum(markets.map(m=>m.borrowers.length)),uniqueBorrowers:new Set(markets.flatMap(m=>m.borrowers.map(b=>b.address))).size,
    marketHHI:sum(markets.map(m=>m.weight**2)),effectiveMarkets:1/sum(markets.map(m=>m.weight**2)),
    observation:{minBlock:Math.min(Number(vs.blockNumber),...markets.map(m=>m.block)),maxBlock:Math.max(Number(vs.blockNumber),...markets.map(m=>m.block)),ageSeconds,atomic:false,oracleBlock:e?.block?.number??null,oracleMismatches:mismatches},
    context:{enrichmentId:enrichment?.snapshotId??null,gasPriceWei:e?.gasPriceWei??null,ethUsd:e?.ethUsd??null,block:e?.block??null,historyId:history?.snapshotId??null},
    history:history?.snapshot??null,
    scope:'One Morpho V1-family vault: its direct lending markets and every borrower, each oracle read on-chain, and a curated registry of the issuers and custodians beneath each collateral token. Conversion-vault internals and feed implementations are not recursively verified.'};
}

/** Which way the oracle moves during the incident, and whether that was observed or assumed. */
function responseFor(m,o,shocked){
  if(!shocked)return {state:'follows',basis:'unaffected',reason:'Not affected by this incident.'};
  if(o.incident==='feed-freeze')return {state:'frozen',basis:'definition',reason:'The selected feed stops updating.'};
  const sight=o.incident==='price-fall'?m.sight.family:o.incident==='depeg'?m.sight.peg:null;
  if(sight&&sight.state==='sees')return {state:'follows',basis:'observed',reason:sight.reason};
  if(sight&&['rate','none'].includes(sight.state))return {state:'frozen',basis:'observed',reason:sight.reason};
  return {state:o.oracleResponse,basis:'assumed',reason:sight?`${sight.reason} Response assumed: ${o.oracleResponse==='follows'?'follows the move':'stays put'}.`:'Response is a scenario assumption.'};
}

/** Lender shortfall from one borrower after a collateral move of `shock`. */
function shortfallOf(b,m,shock,o,response){
  const econ=b.economicValue??(o.unpricedMark==='oracle'?b.oracleValue:null);
  if(econ==null)return null;
  const gap=Math.max(0,b.debt-econ*(1-shock)*(1-o.recoveryDiscount));
  if(o.path!=='gradual'||response!=='follows'||b.oracleValue==null||b.oracleValue<=0||b.debt<=0)return gap;
  const healthNow=b.oracleValue*m.lltv/b.debt,healthEnd=healthNow*(1-shock);
  if(healthEnd>=1)return gap; // never reaches the liquidation boundary
  // Liquidators act if seized collateral, sold at the declared discount, is worth more than the debt repaid.
  const profitable=m.lif*(econ/b.oracleValue)*(1-o.recoveryDiscount)>=1;
  if(!profitable)return gap;
  // Liquidated at the boundary (or now, if already past it): bad debt only if collateral < debt × LIF.
  return healthNow>=1?0:Math.max(0,b.debt-b.oracleValue/m.lif);
}

export function evaluateVault(model, options={}) {
  const o={positionUsd:1_000_000,collateralShock:.35,recoveryDiscount:.05,lossLimit:.1,targetId:'family:BTC',oracleResponse:'follows',incident:'collateral-decline',path:'gap',drain:true,horizonDays:30,
    otherWithdrawalsUsd:0,eventProbability:null,happening:false,exitCostUsd:null,extraExitCost:0,unpricedMark:'range',...options};
  positive(o.positionUsd,'Position size');if(o.positionUsd>model.total*model.usdPrice*1.000001)throw new Error('Position exceeds the observed vault.');
  for(const k of ['collateralShock','recoveryDiscount','lossLimit','extraExitCost'])frac(o[k],k);
  if(!['follows','frozen'].includes(o.oracleResponse)||!INCIDENTS.includes(o.incident))throw new Error('Unsupported incident or oracle response.');
  if(!['gap','gradual'].includes(o.path)||!['range','oracle'].includes(o.unpricedMark))throw new Error('Unsupported path or mark mode.');
  if(!Number.isFinite(o.horizonDays)||o.horizonDays<1||o.horizonDays>365)throw new Error('Horizon must be 1–365 days.');
  if(!Number.isFinite(o.otherWithdrawalsUsd)||o.otherWithdrawalsUsd<0)throw new Error('Other withdrawals must be non-negative.');
  if(o.eventProbability!=null)frac(o.eventProbability,'Event probability');
  if(o.exitCostUsd!=null&&(!Number.isFinite(o.exitCostUsd)||o.exitCostUsd<0))throw new Error('Exit cost must be non-negative.');
  const target=o.targetId==='all'?null:model.dependencies.find(d=>d.id===o.targetId);
  if(o.targetId!=='all'&&!target)throw new Error('Unknown dependency target.');
  const allowed={'collateral-decline':['family','collateral','market','issuer'],'price-fall':['family'],'depeg':['collateral','issuer'],'feed-freeze':['feed','oracle','oracle-vault'],'withdrawal-freeze':['market','collateral','family','issuer']}[o.incident];
  if(target&&!allowed.includes(target.kind))throw new Error(o.incident==='collateral-decline'?'Select collateral or a market for a price decline. Feed/control failure does not imply a price haircut.':`This incident needs a ${allowed.join(' or ')} target.`);
  if(!target&&['price-fall','depeg','feed-freeze'].includes(o.incident))throw new Error('Select what the incident hits.');
  const holding=o.positionUsd/model.usdPrice,ownership=holding/model.total,toUsd=x=>x*ownership*model.usdPrice;
  const priceIncident=o.incident!=='withdrawal-freeze';
  const rows=model.markets.map(m=>{
    const affected=!target||target.marketIds.includes(m.id),shock=affected&&priceIncident?o.collateralShock:0;
    const response=responseFor(m,o,affected&&priceIncident);
    let known=0,base=0,unpriced=m.missingDebt,liquidatableDebt=0,unknownHealthDebt=0,oracleMarked=0;
    const borrowers=m.borrowers.map(b=>{
      const shortfall=shortfallOf(b,m,shock,o,response.state),baseline=shortfallOf(b,m,0,o,'follows');
      if(b.economicValue==null&&o.unpricedMark==='oracle'&&b.oracleValue!=null)oracleMarked+=b.debt;
      if(shortfall==null)unpriced+=b.debt;else{known+=shortfall;base+=baseline;}
      const health=b.oracleValue==null?null:b.oracleValue*(response.state==='follows'?1-shock:1)*m.lltv/b.debt;
      if(health==null)unknownHealthDebt+=b.debt;else if(health<1)liquidatableDebt+=b.debt;
      return {address:b.address,debt:b.debt,economicValue:b.economicValue,shortfall,health};
    });
    // Oracle blind to the move: anyone can post mispriced collateral and borrow the market's cash.
    const drainable=affected&&o.drain&&['depeg','feed-freeze'].includes(o.incident)&&response.state==='frozen'&&shock>0&&m.lltv>1-shock;
    const drain=drainable?m.liquidity*Math.max(0,1-(1-shock)*(1-o.recoveryDiscount)/m.lltv):0;
    const low=Math.min(m.borrow+m.liquidity,known+drain),high=Math.min(m.borrow+m.liquidity,known+drain+unpriced);
    const incident={low:Math.max(0,known-base)+drain,high:Math.max(0,known-base)+drain+(affected?unpriced:0)};
    return {id:m.id,label:m.label,affected,shock,allocation:m.allocated,positionExposure:m.allocated*ownership,lltv:m.lltv,lif:m.lif,liquidatorBreakEven:1-1/m.lif,
      response,sight:m.sight,token:m.token,oracle:m.oracle?{address:m.oracle.address,inputs:m.oracle.inputs.map(i=>i.description??short(i.address)),vault:m.oracle.vault?.symbol??null,verification:m.oracle.verification}:null,
      marketShortfall:{low,high},baselineShortfall:base,drain,drainable,unpricedDebt:unpriced,oracleMarkedDebt:oracleMarked,
      vaultLoss:{low:low*m.supplyFraction,high:high*m.supplyFraction},
      positionLoss:{low:toUsd(low*m.supplyFraction)/model.usdPrice,high:toUsd(high*m.supplyFraction)/model.usdPrice},
      incidentUsd:{low:toUsd(incident.low*m.supplyFraction),high:toUsd(incident.high*m.supplyFraction)},
      existingUsd:toUsd(base*m.supplyFraction),unrelatedUnknownUsd:affected?0:toUsd(unpriced*m.supplyFraction),
      liquidatableDebt,vaultLiquidatableDebt:liquidatableDebt*m.supplyFraction,unknownHealthDebt,borrowerCount:m.borrowers.length,
      withdrawable:affected&&(o.incident==='withdrawal-freeze'||drainable)?0:m.withdrawable,
      borrowers:borrowers.sort((a,b)=>(b.shortfall??b.debt)-(a.shortfall??a.debt)).slice(0,8)};
  });
  const existingUsd=sum(rows.map(r=>r.existingUsd));
  const incidentUsd={low:sum(rows.map(r=>r.incidentUsd.low)),high:sum(rows.map(r=>r.incidentUsd.high))};
  const unrelatedUnknownUsd=sum(rows.map(r=>r.unrelatedUnknownUsd))+toUsd(model.unresolvedAssets);
  const loss={low:existingUsd+incidentUsd.low,high:existingUsd+incidentUsd.high};
  const lossFraction={low:loss.low/o.positionUsd,high:loss.high/o.positionUsd};
  const liquidity=sum(rows.map(r=>r.withdrawable));
  // Available before event losses; unverified ordering and simultaneous exits can
  // reduce it. Never add future liquidation proceeds to immediate cash.
  const before=Math.min(holding,model.queueLiquidity,model.reportedLiquidity)*model.usdPrice;
  const after=Math.min(holding,Math.max(0,Math.min(liquidity,model.reportedLiquidity)-o.otherWithdrawalsUsd/model.usdPrice))*model.usdPrice;
  const decision=decide(model,o,{incidentUsd,after,rows,lossFraction});
  return {settings:o,rows,positionUsd:o.positionUsd,lossUsd:loss,lossFraction,existingUsd,incidentUsd,unrelatedUnknownUsd,
    limitStatus:lossFraction.low>=o.lossLimit?'breached':lossFraction.high<o.lossLimit?'below':'unresolved',
    liquidity:{beforeUsd:before,afterUsd:after,unavailableUsd:o.positionUsd-after,totalQueueUsd:model.queueLiquidity*model.usdPrice,reportedUsd:model.reportedLiquidity*model.usdPrice,
      label:'Queue-based capacity: market cash in the withdrawal queue, capped by reported vault liquidity, after competing exits. Not a transaction simulation.'},
    expectedLossUsd:decision.expectedLoss,expectedAvoidedLossUsd:decision.expectedLoss&&{low:decision.expectedLoss.low*decision.savedFraction,high:decision.expectedLoss.high*decision.savedFraction},decision,
    recognition:{proportionalEconomicLoss:loss,individualPayoutLossEnvelope:{low:0,high:Math.min(o.positionUsd,sum(rows.map(r=>r.vaultLoss.high))*model.usdPrice)},
      note:'Proportional economic exposure is not a promised redemption price. Vault loss-recognition implementation and withdrawal order are unverified.'},
    assumptions:[
      o.path==='gap'?'Instant gap: collateral reprices before any liquidation, then is recovered at the declared sale discount.':'Gradual: liquidations run at the boundary whenever the oracle follows and seized collateral sells above the liquidator break-even; otherwise the gap result applies.',
      'Existing shortfall (before the incident) is reported separately and is not counted as incident loss.',
      'Unpriced debt in markets the incident does not reach is listed as an unrelated unknown, not added to the scenario range.',
      o.drain?'Where the oracle cannot see the move, new borrowers can post mispriced collateral and borrow the market’s current cash. Cash moved in by reallocation is not modelled.':'New borrowing against mispriced collateral is excluded.',
      'Oracle responses are derived from the on-chain oracle inputs where they can be classified; otherwise they are labelled as assumptions.',
      'The position size is hypothetical exposure to a real vault, not a verified wallet or a Belem holding.']};
}

/** Stay or exit: expected avoidable loss against the full cost of leaving for the horizon. */
function decide(model,o,{incidentUsd,after,rows,lossFraction}){
  const savedFraction=o.positionUsd?after/o.positionUsd:0;
  const avoidable={low:incidentUsd.low*savedFraction,high:incidentUsd.high*savedFraction};
  const gasUsd=model.context?.gasPriceWei&&model.context?.ethUsd?model.context.gasPriceWei*(EXIT_GAS_UNITS.withdraw+EXIT_GAS_UNITS.reenter)*model.context.ethUsd/1e18:null;
  const forgoneUsd=model.netApy!=null?after*model.netApy*o.horizonDays/365:null;
  const extraUsd=after*o.extraExitCost;
  const exitCost=o.exitCostUsd!=null?{totalUsd:o.exitCostUsd,gasUsd:null,forgoneUsd:null,extraUsd:null,basis:'manual'}:
    {totalUsd:(gasUsd??0)+(forgoneUsd??0)+extraUsd,gasUsd,forgoneUsd,extraUsd,basis:forgoneUsd==null?'partial':'computed',
     note:`${forgoneUsd!=null?`Yield given up: ${(model.netApy*100).toFixed(2)}% net APY for ${o.horizonDays} days`:'Vault APY not captured'}; gas: ${EXIT_GAS_UNITS.withdraw.toLocaleString('en-US')} + ${EXIT_GAS_UNITS.reenter.toLocaleString('en-US')} units${model.context?.block?` at block ${model.context.block.number}`:''}. Withdrawals redeem at share price, so there is no slippage.`};
  let baseRate=null;
  if(o.incident==='price-fall'&&model.history){
    const family=o.targetId.split(':')[1],series=relativeSeries({series:model.history.series},family,model.loanFamily??'USD');
    baseRate=eventFrequency(series,{shock:o.collateralShock,horizonDays:o.horizonDays,path:o.path});
  }
  const probability=o.happening?{value:1,source:'now'}:o.eventProbability!=null?{value:o.eventProbability,source:'manual'}:baseRate&&baseRate.hits===0?{value:null,source:'never',baseRate}:baseRate?{value:baseRate.probability,source:'empirical',baseRate}:{value:null,source:null};
  const C=exitCost.totalUsd,breakEven={low:avoidable.high>0?Math.min(1,C/avoidable.high):null,high:avoidable.low>0?Math.min(1,C/avoidable.low):null};
  const expectedLoss=probability.value==null?null:{low:probability.value*incidentUsd.low,high:probability.value*incidentUsd.high};
  const e=expectedLoss&&{low:expectedLoss.low*savedFraction,high:expectedLoss.high*savedFraction};
  const drivers=rows.filter(r=>r.incidentUsd.high>0).sort((a,b)=>b.incidentUsd.high-a.incidentUsd.high).slice(0,4)
    .map(r=>({id:r.id,label:`${r.label} · ${(r.lltv*100).toFixed(1)}% LLTV`,lossUsd:r.incidentUsd,response:r.response,drain:r.drain>0}));
  const pct=x=>x==null?'—':x<.001?'<0.1%':`${(x*100).toFixed(x<.1?1:0)}%`,usd=x=>`$${Math.round(x).toLocaleString('en-US')}`;
  let verdict,headline;
  if(o.incident==='withdrawal-freeze'){verdict='STAY';headline="A withdrawal freeze delays access to funds but does not create a loss, so exiting early avoids nothing.";}
  else if(avoidable.high<=0){verdict='STAY';headline=after<=0?"Nothing is withdrawable in this scenario, so exiting is not possible.":!rows.some(r=>r.shock>0)?"This vault has no exposure to the scenario.":'No lender loss: affected borrowers stay collateralised or are liquidated in time.';}
  else if(o.happening&&e.low>C){verdict='EXIT';headline=`Scenario in progress: staying loses about ${usd(e.low)}${e.high>e.low+1?`–${usd(e.high)}`:''}, exiting costs ${usd(C)}. Exit${rows.some(r=>r.drain>0)?' before the market liquidity is borrowed out':''}.`;}
  else if(o.happening&&e.high<C){verdict='STAY';headline=`Even with the scenario in progress, the loss (${usd(e.high)}) is below the ${usd(C)} exit cost.`;}
  else if(e&&e.low>C){verdict='EXIT';headline=`Expected loss of ${usd(e.low)}${e.high>e.low+1?`–${usd(e.high)}`:''} is higher than the ${usd(C)} exit cost. Exit.`;}
  else if(e&&e.high<C){verdict='STAY';headline=`Expected loss is ${usd(e.high)} against a ${usd(C)} exit cost (${o.horizonDays} days of forgone yield + gas), so staying is cheaper.`;}
  else if(e){verdict='REVIEW';headline=`Too close to call: depending on collateral we can't price, expected loss is ${usd(e.low)}–${usd(e.high)} vs a ${usd(C)} exit cost.`;}
  else {verdict='STAY UNLESS';headline=`${probability.source==='never'?`A shock this size never happened in the price data (since ${baseRate.from.slice(0,4)}), so there is no frequency to use. `:'No historical frequency for this scenario. '}Exit if you put the probability above ${pct(breakEven.low)}${breakEven.high!=null&&breakEven.high-breakEven.low>.001?`–${pct(breakEven.high)}`:''} over ${o.horizonDays} days.`;}
  // Cheap insurance: if exiting pays off above a 1% chance and the event would breach the loss limit, exit.
  if(verdict==='STAY UNLESS'&&breakEven.high!=null&&breakEven.high<.01&&lossFraction.low>=o.lossLimit){verdict='EXIT';headline=`Exiting costs ${usd(C)} and pays off above a ${pct(breakEven.high)} probability, while a hit would cost ${pct(lossFraction.low)} of the position, above your ${pct(o.lossLimit)} loss limit. Exit.`;}
  if(lossFraction.low>=o.lossLimit&&verdict!=='EXIT')headline+=` If it does happen, the position loses ${pct(lossFraction.low)}, above your ${pct(o.lossLimit)} loss limit.`;
  if(verdict==='EXIT'&&savedFraction<1)headline+=` (Only ${usd(after)} is withdrawable right now.)`;
  return {verdict,headline,savedFraction,avoidable,exitCost,probability,breakEven,expectedLoss,drivers,limitBreachIfEvent:lossFraction.low>=o.lossLimit,
    reason:probability.source==='empirical'?`Historical frequency since ${baseRate.from.slice(0,4)}: ${baseRate.hits} out of ${baseRate.windows.toLocaleString('en-US')} ${baseRate.horizonDays}-day windows (${baseRate.episodes.length} separate time${baseRate.episodes.length===1?'':'s'}: ${baseRate.episodes.join(', ')}).`:
      probability.source==='now'?'Scenario marked as in progress, so the probability is 100% and the decision is loss vs. exit cost.':probability.source==='never'?`Zero occurrences in ${baseRate.windows.toLocaleString('en-US')} ${baseRate.horizonDays}-day windows (${baseRate.from} to ${baseRate.to}). Zero observations is not a 0% probability, so the break-even is reported instead.`:probability.source==='manual'?'Using your probability.':"No price history exists for this scenario, so the break-even probability is reported."};
}

export function reverseVaultStress(model, options={}) {
  const incident=['price-fall','depeg','feed-freeze'].includes(options.incident)?options.incident:'collateral-decline';
  const at=shock=>evaluateVault(model,{...options,incident,collateralShock:shock});
  const limit=options.lossLimit??.1;
  function boundary(side){if(at(0).lossFraction[side]>=limit)return 0;if(at(1).lossFraction[side]<limit)return null;let lo=0,hi=1;for(let i=0;i<42;i++){const mid=(lo+hi)/2;if(at(mid).lossFraction[side]>=limit)hi=mid;else lo=mid;}return hi;}
  return {possible:boundary('high'),supportedByPricedBorrowers:boundary('low'),label:'Shock size that reaches the loss limit under the same incident and assumptions. A zero boundary can result from existing shortfall or missing valuations; it is not a prediction.'};
}
