import { fetchJson } from './http-client.js';
import { fingerprint } from './core/canonical.js';
import { readFile } from 'node:fs/promises';

export const DEFAULT_VAULT = '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB';
export const VAULT_API = 'https://api.morpho.org/graphql';
const feeds = `baseFeedOne{address} baseFeedTwo{address} quoteFeedOne{address} quoteFeedTwo{address} baseOracleVault{address}`;
export function vaultQuery(address, chainId) {
  return `{vaultByAddress(address:"${address}",chainId:${chainId}){address name chain{id} factory{address} asset{address symbol decimals} liquidity{underlying usd} state{blockNumber timestamp totalAssets totalAssetsUsd totalSupply apy netApy fee owner curator guardian timelock allocation{blockNumber supplyAssets supplyShares supplyAssetsUsd withdrawQueueIndex supplyQueueIndex market{marketId lltv loanAsset{address symbol decimals} collateralAsset{address symbol decimals} oracle{address type data{... on MorphoChainlinkOracleData{${feeds}} ... on MorphoChainlinkOracleV2Data{${feeds} quoteOracleVault{address}}}} state{blockNumber timestamp price supplyAssets supplyShares borrowAssets borrowShares liquidityAssets collateralAssets collateralAssetsUsd}}}}}}`;
}
export function sealVaultSnapshot(snapshot) {
  return { snapshotId: 'vault-' + fingerprint(snapshot), snapshot };
}
export function verifyVaultPacket(packet) {
  if (packet?.snapshot?.schemaVersion !== 'fulcrum-vault-evidence/v1' || sealVaultSnapshot(packet.snapshot).snapshotId !== packet.snapshotId) throw new Error('Vault snapshot fingerprint mismatch.');
  return packet;
}
export async function loadSavedVault() {
  return verifyVaultPacket(JSON.parse(await readFile(new URL('../data/vaults/steakhouse-usdc.json', import.meta.url), 'utf8')));
}

/** Indexed observations, not a pinned-state transaction simulation. Raw queries and
 * responses are retained. A truncated borrower scan stays incomplete. */
export async function discoverVault(address=DEFAULT_VAULT, chainId=1, {request=fetchJson, pageSize=200, maxPages=30, now=()=>new Date().toISOString(), onProgress=()=>{}}={}) {
  if (!/^0x[\da-f]{40}$/i.test(address) || !Number.isSafeInteger(chainId) || chainId<=0) throw new Error('Invalid vault address or chain ID.');
  const startedAt=now(), reads=[], warnings=[],deadline=Date.now()+90_000;
  async function query(q) {
    const response=await request(VAULT_API,'Morpho vault discovery',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({query:q})});
    if(response.errors?.length) throw new Error(response.errors.map(e=>e.message).join('; '));
    reads.push({sourceUrl:VAULT_API,collectedAt:now(),query:q,response});
    return response.data;
  }
  const vault=(await query(vaultQuery(address,chainId))).vaultByAddress;
  if(!vault?.state || vault.address.toLowerCase()!==address.toLowerCase() || vault.chain.id!==chainId) throw new Error('Vault identity or state does not match the request.');
  const allocations=vault.state.allocation.filter(a=>BigInt(a.supplyAssets)>0n);
  if(allocations.length>64) throw new Error('More than 64 funded markets; this capture is outside the adapter budget.');
  const borrowers={};
  // Three bounded scans at a time. Capture is explicit; slider evaluation never fetches.
  for(let start=0;start<allocations.length;start+=3) await Promise.all(allocations.slice(start,start+3).map(async allocation=>{
    const marketId=allocation.market.marketId, items=[], seen=new Set(); let complete=false;
    if(BigInt(allocation.market.state.borrowShares)===0n) {borrowers[marketId]={items,complete:true};return;}
    for(let page=0;page<maxPages;page++) {
      if(Date.now()>=deadline){warnings.push(`${marketId}: capture time budget reached.`);break;}
      const q=`{marketPositions(first:${pageSize},skip:${page*pageSize},where:{marketUniqueKey_in:["${marketId}"],chainId_in:[${chainId}],borrowShares_gte:1}){items{user{address} market{marketId} state{timestamp collateral collateralUsd borrowAssets borrowShares collateralValue}}}}`;
      let rows;
      try{rows=(await query(q)).marketPositions?.items;if(!Array.isArray(rows))throw new Error('Missing borrower rows.');}
      catch(error){warnings.push(`${marketId}: ${error.message}`);break;}
      let added=0;
      for(const row of rows){
        if(row.market?.marketId!==marketId || !/^0x[\da-f]{40}$/i.test(row.user?.address??'')) throw new Error('Borrower identity mismatch.');
        const id=row.user.address.toLowerCase();
        if(seen.has(id))continue;
        seen.add(id);items.push(row);added++;
      }
      if(rows.length<pageSize){complete=true;break;}
      if(!added){warnings.push(`${marketId}: repeated page; borrower scan incomplete.`);break;}
    }
    if(!complete)warnings.push(`${marketId}: incomplete borrower scan.`);
    borrowers[marketId]={items,complete};
    onProgress(`${allocation.market.collateralAsset?.symbol??'Idle'}: ${items.length} borrowers${complete?'':' (partial)'}`);
  }));
  return sealVaultSnapshot({schemaVersion:'fulcrum-vault-evidence/v1',startedAt,capturedAt:now(),chainId,address:vault.address,vault,borrowers,reads,warnings,
    sourceDescription:'Morpho public indexer. Observation blocks and timestamps are retained; requests are not pinned to one block. No independent RPC verification.'});
}
