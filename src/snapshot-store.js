import { readdir, readFile } from "node:fs/promises";
import { fingerprint } from "./core/canonical.js";
import { buildSelectedCaseGraph } from "./core/dependency-graph.js";
import { decimalStringToNumber } from "./math.js";
import { runOracleTomography } from "./tomography.js";
import { join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const directory = fileURLToPath(new URL(".", import.meta.url));
const snapshotsDirectory = normalize(join(directory, "..", "data", "snapshots"));

function rebuildDerivedViews(snapshot) {
  const inputs = snapshot.rawInputs;
  const collateral = decimalStringToNumber(inputs.position?.state?.collateral, 18);
  const debt = decimalStringToNumber(inputs.position?.state?.borrowAssets, 6);
  const debtUsd = Number(inputs.position?.state?.borrowAssetsUsd);
  const oraclePriceLoan = decimalStringToNumber(inputs.oracle?.price, 24);
  if (!(collateral > 0 && debt > 0 && debtUsd > 0 && oraclePriceLoan > 0)) {
    throw new Error("Saved snapshot has insufficient native units to rebuild its derived views.");
  }
  const oraclePriceUsd = oraclePriceLoan * debtUsd / debt;
  return {
    graph: buildSelectedCaseGraph({
      ledger: snapshot.ledger,
      oracleExitState: inputs.oracleInvestigation?.conclusion?.classification
    }),
    tomography: runOracleTomography({
      oraclePriceUsd,
      ptToUnderlyingRate: inputs.pendleSwap?.ptToUnderlyingTokenRate,
      underlyingUsdPrice: Number(inputs.underlyingPrice?.price),
      oracleArchitecture: inputs.oracleInvestigation
    })
  };
}

/**
 * Loads an immutable capture. Graph and tomography are regenerated from the
 * fingerprinted snapshot instead of trusting mutable presentation fields in a
 * JSON file beside it.
 */
export function verifySnapshotPacket(packet) {
  if (!packet?.snapshot?.snapshotId) throw new Error("Incomplete FULCRUM evidence packet.");
  const { snapshotId, sha256, ...contents } = packet.snapshot;
  const actual = fingerprint(contents);
  if (actual !== sha256 || snapshotId !== `fulcrum-${actual.slice(0, 16)}`) throw new Error("Saved evidence fingerprint does not match its contents.");
  if (!Number.isFinite(Date.parse(packet.snapshot.observedAt))) throw new Error("Snapshot observation time is invalid.");
  const derived = rebuildDerivedViews(packet.snapshot);
  return Object.freeze({ snapshot: packet.snapshot, ...derived });
}

export async function loadLatestSavedSnapshot(directoryPath = snapshotsDirectory) {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name);
  const reads = await Promise.allSettled(names.map(async (name) => ({
    ...verifySnapshotPacket(JSON.parse(await readFile(join(directoryPath, name), "utf8"))), fileName: name
  })));
  const candidates = reads.filter((result) => result.status === "fulfilled").map((result) => result.value);
  candidates.sort((left, right) => Date.parse(right.snapshot.observedAt) - Date.parse(left.snapshot.observedAt));
  if (candidates.length === 0) {
    throw new Error("No saved FULCRUM evidence snapshot is available.");
  }
  return Object.freeze(candidates[0]);
}
