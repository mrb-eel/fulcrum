import {mkdir,writeFile} from 'node:fs/promises';
import {discoverVault,DEFAULT_VAULT} from '../src/vault-discovery.js';
const packet=await discoverVault(process.argv[2]??DEFAULT_VAULT,Number(process.argv[3]??1),{onProgress:console.log});
await mkdir(new URL('../data/vaults/',import.meta.url),{recursive:true});
const filename=process.argv[2]?`${packet.snapshot.chainId}-${packet.snapshot.address.toLowerCase()}.json`:'steakhouse-usdc.json';
await writeFile(new URL(`../data/vaults/${filename}`,import.meta.url),JSON.stringify(packet,null,2));
console.log(JSON.stringify({file:filename,snapshotId:packet.snapshotId,capturedAt:packet.snapshot.capturedAt,markets:Object.keys(packet.snapshot.borrowers).length,borrowers:Object.values(packet.snapshot.borrowers).reduce((s,x)=>s+x.items.length,0),warnings:packet.snapshot.warnings}));
