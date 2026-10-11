import { fingerprint } from "./canonical.js";
import { createEvidenceLedger } from "./evidence.js";

export function createEvidenceSnapshot({ caseDefinition, observedAt, rawInputs, evidence }) {
  const ledger = createEvidenceLedger(evidence);
  const contents = {
    schemaVersion: "fulcrum-snapshot/v1",
    caseDefinition,
    observedAt,
    rawInputs,
    ledger
  };
  const sha256 = fingerprint(contents);
  return Object.freeze({
    ...contents,
    snapshotId: `fulcrum-${sha256.slice(0, 16)}`,
    sha256
  });
}
