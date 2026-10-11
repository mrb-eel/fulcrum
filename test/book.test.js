import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBook,evaluateBook,sharedDependencies} from '../src/book-engine.js';
import {evaluateVault} from '../src/vault-engine.js';
import {eventFrequency} from '../src/base-rates.js';
import {pegSight,lookupToken,liquidationIncentive} from '../src/registry.js';
import {classifySource} from '../src/lending-scan.js';

const book=await loadBook();
const steak=book.pockets.find(p=>p.id==='steakhouse-usdc').model;
const token=sym=>steak.dependencies.find(d=>d.kind==='collateral'&&d.label===sym).id;

test('every pocket verifies against its fingerprint and the on-chain oracle reads',()=>{
  assert.equal(book.pockets.length,10);
  for(const p of book.pockets)assert.ok(p.model.markets.length>0);
  assert.equal(steak.observation.oracleMismatches,0);
});
test('the cbBTC oracle cannot see cbBTC/BTC; the WBTC oracle can',()=>{
  const cb=steak.markets.filter(m=>m.label==='cbBTC'&&m.oracle?.kind==='morpho-chainlink'),wb=steak.markets.filter(m=>m.label==='WBTC'&&m.oracle?.kind==='morpho-chainlink');
  assert.ok(cb.length&&cb.every(m=>m.sight.peg.state==='none'));assert.ok(wb.length&&wb.every(m=>m.sight.peg.state==='sees'));
  assert.ok(steak.dependencies.some(d=>d.kind==='blindspot'&&/cbBTC/.test(d.label)));
});
test('exchange-rate feeds are classified as rates, not market prices',()=>{
  const oracle={kind:'morpho-chainlink',inputs:[{description:'weETH/ETH exchange rate'},{description:'ETH / USD'}]};
  assert.equal(pegSight(lookupToken('0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee','weETH'),oracle).state,'rate');
});
test('Morpho liquidation incentive matches the protocol formula',()=>{assert.ok(Math.abs(liquidationIncentive(.86)-1.0438)<1e-4);assert.equal(liquidationIncentive(.2),1.15);});
test('gradual BTC fall with profitable liquidations costs lenders nothing; an instant gap does',()=>{
  const g=evaluateVault(steak,{incident:'price-fall',targetId:'family:BTC',path:'gradual',recoveryDiscount:.02});
  const x=evaluateVault(steak,{incident:'price-fall',targetId:'family:BTC',path:'gap',recoveryDiscount:.02});
  assert.equal(Math.round(g.incidentUsd.low),0);assert.ok(x.incidentUsd.low>1000);
  // Above the liquidator break-even (~4.2% at 86% LLTV) liquidations stop and the gap result returns.
  const stalled=evaluateVault(steak,{incident:'price-fall',targetId:'family:BTC',path:'gradual',recoveryDiscount:.05});assert.ok(stalled.incidentUsd.low>0);
});
test('a blind oracle turns a depeg into a loss and drains cash; a seeing oracle does not',()=>{
  const cb=evaluateVault(steak,{incident:'depeg',targetId:token('cbBTC'),path:'gradual',recoveryDiscount:.02});
  const wb=evaluateVault(steak,{incident:'depeg',targetId:token('WBTC'),path:'gradual',recoveryDiscount:.02});
  assert.ok(cb.incidentUsd.low>wb.incidentUsd.low);assert.ok(cb.rows.some(r=>r.drain>0));assert.ok(wb.rows.every(r=>r.drain===0));
  assert.equal(cb.decision.verdict,'STAY UNLESS');assert.ok(cb.decision.breakEven.low>0);
});
test('default BTC scenario produces a verdict from an empirical frequency and a computed exit cost',()=>{
  const r=evaluateVault(steak,{incident:'price-fall',targetId:'family:BTC'});
  assert.ok(['STAY','EXIT','REVIEW'].includes(r.decision.verdict));assert.equal(r.decision.probability.source,'empirical');
  assert.ok(r.decision.exitCost.forgoneUsd>0&&r.decision.exitCost.gasUsd>0);
});
test('event frequency counts windows and episodes',()=>{
  const closes=[...Array(200)].map((_,i)=>[i*86400,i===100?50:100]);
  const f=eventFrequency({closes,label:'X/USD',source:'t'},{shock:.4,horizonDays:10,path:'gap'});
  assert.equal(f.hits,10);assert.equal(f.episodes.length,1);
});
test('the book applies one incident to every pocket and finds shared dependencies',()=>{
  const r=evaluateBook(book,{incident:'price-fall',targetId:'family:BTC',collateralShock:.35});
  assert.equal(r.rows.length,10);assert.ok(r.exposedPockets>=5);assert.ok(r.rows.filter(x=>!x.exposed).every(x=>x.incidentUsd.high===0));
  const shared=sharedDependencies(book.pockets);assert.ok(shared.find(s=>s.kind==='protocol').pockets.length===10);
  assert.ok(shared.some(s=>s.kind==='feed'&&/BTC \/ USD/.test(s.label)&&s.pockets.length>=4));
});
test('pooled-protocol oracle sources are classified from their own description',()=>{
  const t=(sym,a)=>lookupToken(a,sym);
  assert.equal(classifySource('cbBTC','BTC / USD',t('cbBTC','0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf')).state,'none');
  assert.equal(classifySource('USDe','Capped USDT/USD',t('USDe','0x4c9edd5852cd905f086c759e8383e09bff1e68b3')).state,'none');
  assert.equal(classifySource('wstETH','Capped wstETH / stETH(ETH) / USD',null).state,'rate');
  assert.equal(classifySource('WBTC','wBTC/BTC/USD',t('WBTC','0x2260fac5e5542a773aa44fbcfedf7c193bc2c599')).state,'sees');
  assert.equal(classifySource('USDC','Capped USDC / USD',null).state,'sees');
  assert.equal(classifySource('PT-sUSDE-5FEB2026','PT Capped sUSDe USDT/USD linear discount 05FEB2026',null).state,'rate');
  assert.equal(classifySource('rETH',null,null).state,'unknown');
});
