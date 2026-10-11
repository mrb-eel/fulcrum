import test from 'node:test';
import assert from 'node:assert/strict';
import {buildVaultModel,evaluateVault,reverseVaultStress} from '../src/vault-engine.js';
import {sealVaultSnapshot,verifyVaultPacket,loadSavedVault,discoverVault} from '../src/vault-discovery.js';
import {createAppServer} from '../src/server.js';

const addr=n=>'0x'+n.toString(16).padStart(40,'0'),mid=n=>'0x'+n.toString(16).padStart(64,'0');
const near=(a,b,epsilon=.0001)=>assert.ok(Math.abs(a-b)<epsilon,`${a} != ${b}`);
function fixture(){
  const token={address:addr(1),symbol:'USDC',decimals:6},collateral={address:addr(2),symbol:'TEST',decimals:6};
  const allocations=[1,2].map(i=>({supplyAssets:500e6,withdrawQueueIndex:i-1,market:{marketId:mid(i),lltv:'800000000000000000',loanAsset:token,collateralAsset:collateral,
    oracle:{address:addr(3+i),type:'ChainlinkOracleV2',data:{baseFeedOne:{address:addr(9)},quoteFeedOne:{address:addr(9)}}},
    state:{supplyAssets:1000e6,borrowAssets:800e6,borrowShares:'800000000000000',liquidityAssets:200e6,collateralAssets:1000e6,collateralAssetsUsd:1000,price:'1000000000000000000000000000000000000',timestamp:1700000000,blockNumber:100}}}));
  const borrowers=Object.fromEntries([1,2].map(i=>[mid(i),{complete:true,items:[{user:{address:addr(100+i)},market:{marketId:mid(i)},state:{collateral:400e6,borrowShares:'500000000000000',timestamp:1700000000}},{user:{address:addr(200+i)},market:{marketId:mid(i)},state:{collateral:600e6,borrowShares:'300000000000000',timestamp:1700000000}}]}]));
  return sealVaultSnapshot({schemaVersion:'fulcrum-vault-evidence/v1',address:addr(8),chainId:1,capturedAt:'2023-11-14T22:13:20.000Z',vault:{address:addr(8),name:'Test vault',chain:{id:1},factory:{address:addr(7)},asset:token,liquidity:{underlying:400e6},state:{totalAssets:1000e6,totalAssetsUsd:1000,timelock:86400,blockNumber:100,timestamp:1700000000,allocation:allocations}},borrowers,warnings:[],reads:[]});
}
test('borrower shortfalls cannot be offset by another borrower surplus; lender and holder fractions are applied',()=>{
  const m=buildVaultModel(fixture()),r=evaluateVault(m,{targetId:'all',positionUsd:100,collateralShock:0,recoveryDiscount:0});
  // Each market: 500 debt / 400 collateral loses 100. The other borrower has
  // surplus 300, but cannot bail it out. Vault owns half; holder owns 10%.
  near(r.lossUsd.low,10);near(r.lossUsd.high,10);near(r.rows[0].vaultLoss.low,50);
});
test('same feed reached twice is a single dependency with union exposure, not duplicate dollars',()=>{
  const m=buildVaultModel(fixture()),feed=m.dependencies.find(d=>d.kind==='feed');
  assert.equal(feed.marketIds.length,2);near(feed.exposure,1000);
});
test('borrower exposure counts the vault share of debt, not every dollar in its markets',()=>{
  const p=fixture();p.snapshot.borrowers[mid(2)].items[0].user.address=addr(101);
  const m=buildVaultModel(p),b=m.dependencies.find(d=>d.id==='borrower:1:'+addr(101));
  assert.equal(b.marketIds.length,2);near(b.exposure,500);
});
test('zero collateral is a known full debt shortfall even when its asset has no market mark',()=>{
  const p=fixture();p.snapshot.borrowers[mid(1)].items[0].state.collateral=0;p.snapshot.vault.state.allocation[0].market.state.collateralAssetsUsd=null;
  const r=evaluateVault(buildVaultModel(p),{targetId:'all',positionUsd:100,collateralShock:0,recoveryDiscount:0});near(r.lossUsd.low,30);
});
test('missing economic marks widen the bound without substituting an oracle price',()=>{
  const p=fixture();p.snapshot.vault.state.allocation[0].market.state.collateralAssetsUsd=null;
  const r=evaluateVault(buildVaultModel(p),{targetId:'all',positionUsd:100,collateralShock:0,recoveryDiscount:0});
  near(r.lossUsd.low,5);near(r.lossUsd.high,45);assert.equal(r.limitStatus,'unresolved');
});
test('queue cash is capped by reported liquidity and competing exits; unavailable money is not added to loss',()=>{
  const p=fixture();p.snapshot.vault.liquidity.underlying=300e6;
  const m=buildVaultModel(p),base={targetId:'all',positionUsd:100,collateralShock:0,recoveryDiscount:0};
  const a=evaluateVault(m,base),b=evaluateVault(m,{...base,otherWithdrawalsUsd:250});
  near(a.liquidity.afterUsd,100);near(b.liquidity.afterUsd,50);near(b.liquidity.unavailableUsd,50);near(a.lossUsd.low,b.lossUsd.low);
  const freeze=evaluateVault(m,{...base,targetId:'market:'+mid(1),incident:'withdrawal-freeze'});
  near(freeze.rows[0].withdrawable,0);near(freeze.lossUsd.low,a.lossUsd.low);
});
test('off-queue funds are not treated as immediate cash',()=>{
  const p=fixture();p.snapshot.vault.state.allocation.forEach(a=>a.withdrawQueueIndex=null);
  const r=evaluateVault(buildVaultModel(p),{targetId:'all',positionUsd:100});near(r.liquidity.afterUsd,0);
});
test('oracle freeze affects liquidation eligibility, not the reference collateral recovery value',()=>{
  const m=buildVaultModel(fixture()),settings={targetId:'all',positionUsd:100,collateralShock:.6,recoveryDiscount:0};
  const a=evaluateVault(m,{...settings,oracleResponse:'follows'}),b=evaluateVault(m,{...settings,oracleResponse:'frozen'});
  near(a.lossUsd.low,b.lossUsd.low);assert.ok(a.rows[0].liquidatableDebt>b.rows[0].liquidatableDebt);
});
test('reverse stress finds the boundary and distinguishes an unreachable loss limit',()=>{
  const m=buildVaultModel(fixture()),opts={targetId:'all',positionUsd:100,recoveryDiscount:0,lossLimit:.3};
  const reverse=reverseVaultStress(m,opts);const r=evaluateVault(m,{...opts,collateralShock:reverse.supportedByPricedBorrowers});near(r.lossFraction.low,.3,1e-8);
  assert.equal(reverseVaultStress(m,{...opts,lossLimit:.9}).supportedByPricedBorrowers,null);
});
test('missing borrowers are bounded and duplicate or inconsistent records are rejected',()=>{
  const p=fixture();p.snapshot.borrowers[mid(1)].items.pop();p.snapshot.borrowers[mid(1)].complete=false;
  const m=buildVaultModel(p);assert.ok(m.markets[0].missingDebt>299);assert.ok(evaluateVault(m,{positionUsd:100,targetId:'all'}).lossUsd.high>30);
  const d=fixture();d.snapshot.borrowers[mid(1)].items.push(d.snapshot.borrowers[mid(1)].items[0]);assert.throws(()=>buildVaultModel(d),/Duplicate/);
  const q=fixture();q.snapshot.vault.state.allocation[0].market.loanAsset={...q.snapshot.vault.asset,address:addr(55)};assert.throws(()=>buildVaultModel(q),/loan asset/);
});
test('invalid scenarios and unsafe source numbers fail closed',()=>{
  const m=buildVaultModel(fixture());for(const opts of [{collateralShock:-1},{positionUsd:2000},{eventProbability:2},{otherWithdrawalsUsd:-1},{targetId:'missing'},{targetId:'feed:1:'+addr(9)}])assert.throws(()=>evaluateVault(m,{targetId:'all',positionUsd:100,...opts}));
  const p=fixture();p.snapshot.vault.state.totalAssets=Number.MAX_SAFE_INTEGER+1;assert.throws(()=>buildVaultModel(p),/Unsafe integer/);
});
test('evidence fingerprint detects changed raw data',()=>{const p=fixture();verifyVaultPacket(p);p.snapshot.vault.name='Changed';assert.throws(()=>verifyVaultPacket(p),/fingerprint/);});
test('real saved case reconciles all borrower shares and has independently discovered shared feeds',async()=>{
  const packet=await loadSavedVault(),m=buildVaultModel(packet);
  assert.equal(m.markets.length,11);assert.equal(m.borrowerCount,1635);assert.equal(m.markets.filter(m=>m.complete).length,11);near(m.unresolvedAssets,0);
  const feed=m.dependencies.find(d=>d.id==='feed:1:0xf4030086522a5beea4988f8ca5b36dbc97bee88c');assert.equal(feed.marketIds.length,2);assert.ok(feed.exposure/m.total>.58);
  // The unpriced steakEURCV market is outside a BTC scenario: it is reported separately, not added to the range.
  const r=evaluateVault(m);assert.ok(r.unrelatedUnknownUsd>100_000);near(r.lossUsd.high,r.lossUsd.low,1);
  const all=evaluateVault(m,{targetId:'all'});assert.ok(all.lossUsd.high>all.lossUsd.low);assert.equal(all.unrelatedUnknownUsd,0);
});
test('discovery paginates and keeps incomplete coverage rather than pretending a page limit is complete',async()=>{
  const p=fixture(),calls=[];
  const request=async(url,source,options)=>{const q=JSON.parse(options.body).query;calls.push(q);if(q.includes('vaultByAddress'))return {data:{vaultByAddress:p.snapshot.vault}};const id=q.includes(mid(1))?mid(1):mid(2);return {data:{marketPositions:{items:p.snapshot.borrowers[id].items.slice(0,1)}}};};
  const r=await discoverVault(addr(8),1,{request,pageSize:1,maxPages:1});assert.equal(Object.values(r.snapshot.borrowers).every(b=>!b.complete),true);assert.ok(r.snapshot.warnings.length);assert.equal(calls.length,3);
});
test('HTTP main case, evaluation, graph, evidence and previous workspace are accessible',async t=>{
  const server=createAppServer({vaultLoader:async()=>fixture()});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const root=`http://127.0.0.1:${server.address().port}`;
  const page=await(await fetch(root+'/vault.html')).text();assert.match(page,/vault/i);assert.match(await(await fetch(root+'/portfolio.html')).text(),/Positions & dependencies/);
  const response=await fetch(root+'/api/vault/evaluate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({targetId:'all',positionUsd:100,collateralShock:0,recoveryDiscount:0})});assert.equal(response.status,200);near((await response.json()).result.lossUsd.low,10);
  for(const path of ['/api/vault/graph','/api/vault/evidence'])assert.equal((await fetch(root+path)).status,200);
  const invalid=await fetch(root+'/api/vault/evaluate',{method:'POST',body:JSON.stringify({positionUsd:-1})});assert.equal(invalid.status,400);
});
