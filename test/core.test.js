import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "../src/core/canonical.js";
import { createEvidenceLedger } from "../src/core/evidence.js";
import { findDependencyPaths, validateDependencyGraph } from "../src/core/dependency-graph.js";

test("snapshot fingerprints do not depend on JavaScript object key order", () => {
  assert.equal(fingerprint({ b: 2, a: { z: true, y: 1 } }), fingerprint({ a: { y: 1, z: true }, b: 2 }));
});

test("an observed claim cannot enter the ledger without a source", () => {
  assert.throws(() => createEvidenceLedger([{ id: "missing-source", claim: "Claim", status: "observed", observedAt: "2026-10-10T00:00:00.000Z" }]));
});

test("a graph edge cannot claim support from missing evidence", () => {
  const ledger = createEvidenceLedger([{
    id: "real-evidence",
    claim: "Claim",
    status: "observed",
    observedAt: "2026-10-10T00:00:00.000Z",
    sources: [{ provider: "Test", url: "https://example.com" }]
  }]);
  assert.throws(() => validateDependencyGraph({
    nodes: [{ id: "a" }, { id: "b" }],
    edges: [{ id: "broken", from: "a", to: "b", capability: "value", evidenceIds: ["missing"] }]
  }, ledger));
});

test("dependency paths are cycle-safe and capability-aware", () => {
  const graph = {
    nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
    edges: [
      { id: "ab", from: "a", to: "b", capability: "value", evidenceIds: ["e"] },
      { id: "bc", from: "b", to: "c", capability: "value", evidenceIds: ["e"] },
      { id: "ba", from: "b", to: "a", capability: "value", evidenceIds: ["e"] }
    ]
  };
  assert.equal(findDependencyPaths(graph, "a", "c", "value").length, 1);
});
