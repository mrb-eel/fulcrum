import test from "node:test";
import assert from "node:assert/strict";
import { runOracleTomography } from "../src/tomography.js";

test("marks closely aligned live values as consistent but unconfirmed", () => {
  const result = runOracleTomography({
    oraclePriceUsd: 0.992362,
    ptToUnderlyingRate: 0.7934445181765974,
    underlyingUsdPrice: 1.2515139135377376
  });

  assert.equal(result.classification, "consistent_but_unconfirmed");
  assert.ok(result.inputs.absoluteBasisBps < 50);
  assert.equal(result.hypotheses.find((item) => item.id === "independent-source").result, "unresolved");
});

test("flags a material divergence without inventing an explanation", () => {
  const result = runOracleTomography({
    oraclePriceUsd: 1,
    ptToUnderlyingRate: 0.9,
    underlyingUsdPrice: 1
  });

  assert.equal(result.classification, "divergent");
  assert.equal(result.hypotheses.find((item) => item.id === "market-aware").result, "not-supported");
  assert.equal(result.hypotheses.find((item) => item.id === "independent-source").result, "plausible");
});
