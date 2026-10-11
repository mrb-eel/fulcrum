import test from "node:test";
import assert from "node:assert/strict";
import { loadLatestSavedSnapshot, verifySnapshotPacket } from "../src/snapshot-store.js";
import { createAppServer } from "../src/server.js";
import { analyzePacket } from "../src/analysis.js";
import { fetchJson } from "../src/http-client.js";
import { buildPositionSnapshot } from "../src/position.js";

const packet = await loadLatestSavedSnapshot();

test("saved evidence fingerprint rejects a modified balance", () => {
  const tampered = structuredClone(packet);
  tampered.snapshot.rawInputs.position.state.borrowAssetsUsd += 100;
  assert.throws(() => verifySnapshotPacket(tampered), /fingerprint/);
});

test("saved top-level graph and tomography are rebuilt from the fingerprinted snapshot", () => {
  const tampered = structuredClone(packet);
  tampered.graph.nodes[0].label = "fabricated route";
  tampered.tomography.conclusion = "fabricated conclusion";
  const verified = verifySnapshotPacket(tampered);
  assert.notEqual(verified.graph.nodes[0].label, "fabricated route");
  assert.notEqual(verified.tomography.conclusion, "fabricated conclusion");
});

test("an API outage retains a usable saved analysis and names the blocked provider", async (t) => {
  let liveReads = 0;
  const server = createAppServer({ savedLoader: async () => packet, liveLoader: async () => {
    liveReads += 1;
    const error = new Error("Morpho: outbound connection blocked.");
    error.code = "EACCES"; error.provider = "Morpho"; throw error;
  } });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const before = await (await fetch(root + "/api/demo-analysis")).json();
  const failure = await fetch(root + "/api/live-analysis");
  assert.equal(failure.status, 503);
  assert.equal((await failure.json()).code, "NETWORK_ACCESS_BLOCKED");
  const after = await (await fetch(root + "/api/demo-analysis?exitDiscount=0.03")).json();
  assert.equal(before.packet.snapshot.snapshotId, after.scenario.snapshotId);
  assert.ok(after.scenario.result.equityLossUsd > before.scenario.result.equityLossUsd);
  assert.equal(liveReads, 1);
  assert.equal((await fetch(root + "/api/demo-analysis?lossLimit=garbage")).status, 400);
  assert.equal((await fetch(root + "/engine/analysis.js")).status, 200);
  assert.equal((await fetch(root + "/engine/oracle-investigation.js")).status, 404);
});

test("provider failures are bounded, named, and permission errors are not retried", async () => {
  let requests = 0;
  await assert.rejects(fetchJson("https://example.invalid", "Test provider", {}, { fetchImpl: async () => {
    requests += 1; throw new Error("fetch failed", { cause: { code: "EACCES" } });
  } }), (error) => error.provider === "Test provider" && error.code === "EACCES");
  assert.equal(requests, 1);
});

test("shared analysis stays on the supplied packet and solves the loss threshold", () => {
  const analysis = analyzePacket(packet);
  const boundary = analyzePacket(packet, { exitDiscount: analysis.thresholdExitDiscount });
  assert.ok(Math.abs(boundary.scenario.result.equityLossFraction - .1) < 1e-7);
  const changed = structuredClone(packet);
  changed.snapshot.snapshotId = "test-new-capture";
  changed.snapshot.rawInputs.position.state.collateral = String(BigInt(changed.snapshot.rawInputs.position.state.collateral) + 100000000000000000000n);
  const next = analyzePacket(changed);
  assert.equal(next.scenario.snapshotId, "test-new-capture");
  assert.equal(next.decision.snapshotId, "test-new-capture");
  assert.notEqual(next.scenario.result.equityLossFraction, analysis.scenario.result.equityLossFraction);
});

test("an active backup cannot silently reuse the fixed-primary demo", () => {
  const changed = structuredClone(packet);
  changed.snapshot.rawInputs.oracleInvestigation.oracle.isPrimary = false;
  assert.throws(() => analyzePacket(changed), /configuration has changed/);
});

test("the position endpoint uses native loan units and the traced oracle route", () => {
  const inputs = structuredClone(packet.snapshot.rawInputs);
  // A change in the API's USD market marks must not alter Morpho loan health.
  inputs.position.state.collateralUsd *= 1.5;
  inputs.position.state.borrowAssetsUsd *= 1.2;
  const position = buildPositionSnapshot(inputs, packet.snapshot.observedAt);
  const expected = analyzePacket(packet).scenario.baseline.healthFactor;
  assert.equal(position.observed.healthFactor, Number(expected.toFixed(4)));
  assert.equal(position.tomography.classification, "direct_exit_dependency_refuted");
  assert.notEqual(position.observed.oraclePriceUsd, position.observed.oraclePriceUsdc);
});
