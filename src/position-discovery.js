import { fetchJson } from "./http-client.js";
import { decimalStringToNumber } from "./math.js";
import { SCHEMA } from "./portfolio-engine.js";

const API="https://api.morpho.org";
const usd=(x)=>x===null||x===undefined?null:Number(x);
const tokenId=(chain,token)=>`${chain}:${token.address.toLowerCase()}`;
export function validateDiscovery(address,chainId) {
  if(!/^0x[0-9a-fA-F]{40}$/.test(address??"")) throw Object.assign(new Error("Enter a 20-byte EVM wallet address."),{status:400});
  if(!Number.isSafeInteger(chainId)||chainId<=0) throw Object.assign(new Error("Chain ID must be a positive integer."),{status:400});
}

export function normalizeMorphoRow(row,{chainId,observedAt,address,oracleState=null}) {
  const m=row.market,s=row.state;
  if(!m||!s||!/^0x[0-9a-fA-F]{64}$/.test(m.marketId)) throw new Error("Market identity or position balances missing.");
  const sourceUrl=`${API}/v0/blue/markets/${chainId}:${m.marketId}`;
  const loanId=tokenId(chainId,m.loanAsset),collateralId=m.collateralAsset?tokenId(chainId,m.collateralAsset):null;
  const evidence=[{id:"position",claim:"Morpho reports these market balances for the requested address.",status:"observed",sourceUrl:`${API}/graphql`},
    {id:"market",claim:"Morpho reports these market assets, LLTV and oracle address.",status:"observed",sourceUrl}];
  const base={protocol:"Morpho Blue",chainId,owner:address,marketId:m.marketId,origin:"observed",observedAt,quotes:[],evidence,oracle:{mode:"unknown",denomination:"loan",evidenceIds:[]}};
  const positions=[];
  if(BigInt(s.collateral??"0")>0n||BigInt(s.borrowAssets??"0")>0n) {
    if(!collateralId) throw new Error("Collateral metadata missing.");
    const amount=decimalStringToNumber(s.collateral,m.collateralAsset.decimals);
    const debtAmount=decimalStringToNumber(s.borrowAssets,m.loanAsset.decimals);
    let oracleValueUsd=null;
    if(oracleState?.price && debtAmount>0 && usd(s.borrowAssetsUsd)!==null) {
      const scale=36+m.loanAsset.decimals-m.collateralAsset.decimals;
      const price=decimalStringToNumber(oracleState.price,scale);
      oracleValueUsd=amount*price*Number(s.borrowAssetsUsd)/debtAmount;
    }
    const oracleId=m.oracle?.address?`oracle:${chainId}:${m.oracle.address.toLowerCase()}`:`unknown-oracle:${m.marketId}`;
    positions.push({...base,id:`morpho:${chainId}:${m.marketId}:${address}:borrow`,label:`${m.collateralAsset.symbol} / ${m.loanAsset.symbol}`,kind:"collateralized-loan",
      assets:[{id:collateralId,symbol:m.collateralAsset.symbol,role:"collateral",valueUsd:usd(s.collateralUsd),oracleValueUsd,liquidationThreshold:Number(m.lltv)/1e18},
        {id:loanId,symbol:m.loanAsset.symbol,role:"debt",valueUsd:usd(s.borrowAssetsUsd)}],
      dependencies:[{id:`token:${collateralId}`,label:`${m.collateralAsset.symbol} market value`,lens:"value",status:"observed",assetIds:[collateralId],evidenceIds:["market"]},
        {id:oracleId,label:"Oracle implementation not traced",lens:"liquidation",status:"unresolved",assetIds:[collateralId],evidenceIds:["market"]},
        {id:`chain:${chainId}`,label:`Chain ${chainId} settlement`,lens:"control",status:"observed",assetIds:[collateralId],evidenceIds:["market"]},
        {id:`exit:${chainId}:${m.marketId}`,label:"Withdrawal and sale route",lens:"exit",status:"unresolved",assetIds:[collateralId],evidenceIds:[]}]});
  }
  if(BigInt(s.supplyAssets??"0")>0n) positions.push({...base,id:`morpho:${chainId}:${m.marketId}:${address}:supply`,label:`${m.loanAsset.symbol} supply`,kind:"supply",oracle:{mode:"none",evidenceIds:[]},
    assets:[{id:loanId,symbol:m.loanAsset.symbol,role:"holding",valueUsd:usd(s.supplyAssetsUsd)}],
    dependencies:[{id:`token:${loanId}`,label:`${m.loanAsset.symbol} value`,lens:"value",status:"observed",assetIds:[loanId],evidenceIds:["market"]},
      {id:`market:${chainId}:${m.marketId}`,label:"Borrower solvency and withdrawal liquidity",lens:"exit",status:"unresolved",assetIds:[loanId],evidenceIds:["market"]}]});
  return positions;
}

/** Paginated, bounded wallet discovery; separate supply and borrow accounting.
 * API schema reference: https://docs.morpho.org/developers/api/morpho/
 * Network use is injectable for deterministic offline integration tests.
 */
export async function discoverMorpho(address,chainId,{request=fetchJson,pageSize=100,maxPages=20,now=()=>new Date().toISOString()}={}) {
  validateDiscovery(address,chainId); address=address.toLowerCase();
  const observedAt=now(),rows=[],seen=new Set(),warnings=[]; let complete=false;
  const deadline=Date.now()+40_000;
  for(let page=0;page<maxPages;page++) {
    if(Date.now()>deadline) {warnings.push("Discovery reached its time budget; coverage is incomplete.");break;}
    const query=`query { marketPositions(first:${pageSize},skip:${page*pageSize},where:{userAddress_in:["${address}"],chainId_in:[${chainId}]}) { items { user { address } market { marketId lltv oracle { address } loanAsset { address symbol decimals } collateralAsset { address symbol decimals } } state { collateral collateralUsd borrowAssets borrowAssetsUsd supplyAssets supplyAssetsUsd } } } }`;
    let data;
    try {
      const response=await request(`${API}/graphql`,"Morpho wallet discovery",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query})});
      if(response.errors?.length) throw new Error(response.errors[0].message);
      data=response.data?.marketPositions?.items;
      if(!Array.isArray(data)) throw new Error("Invalid marketPositions response.");
    } catch(error) {if(!rows.length) throw error;warnings.push(`Discovery stopped on page ${page+1}: ${error.message}`);break;}
    let added=0;
    for(const row of data) {
      if(row.user?.address?.toLowerCase()!==address) throw new Error("Provider returned a different wallet; capture rejected.");
      const id=row.market?.marketId;
      if(!id) {rows.push(row);added++;} else if(!seen.has(id)) {seen.add(id);rows.push(row);added++;}
    }
    if(data.length<pageSize) {complete=true;break;}
    if(!added) {warnings.push("Pagination repeated a page; remaining coverage is unknown.");break;}
  }
  if(!complete&&!warnings.length) warnings.push("Discovery reached its page limit; the result is incomplete.");
  const positions=[];
  // Four independent oracle reads at a time, rather than an unbounded request burst.
  for(let i=0;i<rows.length;i+=4) {
    const batch=await Promise.all(rows.slice(i,i+4).map(async(row,index)=>{
      let oracleState=null;
      if(Date.now()<=deadline&&/^0x[0-9a-fA-F]{40}$/.test(row.market?.oracle?.address??"")&&/^\d+$/.test(row.state?.borrowAssets??"")&&BigInt(row.state.borrowAssets)>0n) {
        try {oracleState=(await request(`${API}/v0/oracles/${chainId}:${row.market.oracle.address}/state`,"Morpho oracle marks")).data;}
        catch(error) {warnings.push(`Oracle mark unavailable for ${row.market.marketId}: ${error.message}`);}
      }
      try {return normalizeMorphoRow(row,{chainId,observedAt,address,oracleState});}
      catch(error) {return [{id:`unresolved:${chainId}:${address}:${i+index}`,label:"Unresolved Morpho position",kind:"unsupported",origin:"observed",observedAt,assets:[],oracle:{mode:"unknown"},evidence:[],dependencies:[],quotes:[],importIssue:error.message}];}
    }));positions.push(...batch.flat());
  }
  if(Date.now()>deadline) warnings.push("Oracle enrichment reached its time budget; missing marks remain unknown.");
  return {schemaVersion:SCHEMA,label:`Morpho wallet ${address.slice(0,6)}…${address.slice(-4)}`,positions,
    scope:{complete,description:`Morpho Blue positions on chain ${chainId} only. Other protocols, wallet tokens and vaults are outside this scan.`,warnings,observedAt}};
}
