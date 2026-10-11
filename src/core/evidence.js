const VALID_STATUSES = new Set(["observed", "derived", "inference_to_test", "scenario_assumption", "unknown"]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function makeEvidence(record) {
  assert(record?.id, "Evidence requires a stable id.");
  assert(record.claim, `Evidence '${record.id}' requires a claim.`);
  assert(VALID_STATUSES.has(record.status), `Evidence '${record.id}' has an invalid status.`);
  assert(record.observedAt, `Evidence '${record.id}' requires an observation time.`);
  assert(!Number.isNaN(Date.parse(record.observedAt)), `Evidence '${record.id}' has an invalid observation time.`);

  if (record.status === "observed") {
    assert(record.sources?.length, `Observed evidence '${record.id}' requires at least one source.`);
  }
  for (const source of record.sources ?? []) {
    assert(source.provider && source.url, `Evidence '${record.id}' has an incomplete source.`);
  }
  if (record.status === "derived" || record.status === "inference_to_test") {
    assert(record.inputs?.length, `Derived or inferred evidence '${record.id}' requires explicit inputs.`);
  }
  return Object.freeze({ ...record, sources: Object.freeze([...(record.sources ?? [])]), inputs: Object.freeze([...(record.inputs ?? [])]) });
}

export function createEvidenceLedger(records) {
  const items = records.map(makeEvidence);
  const ids = new Set(items.map((item) => item.id));
  assert(ids.size === items.length, "Evidence ids must be unique.");
  return Object.freeze({
    schemaVersion: "evidence-ledger/v1",
    items: Object.freeze(items)
  });
}

export function evidenceById(ledger) {
  return new Map(ledger.items.map((item) => [item.id, item]));
}
