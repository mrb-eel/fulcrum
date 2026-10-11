import test from "node:test";
import assert from "node:assert/strict";
import { buildDecisionFrontier, buildObservedExitOptions } from "../src/decision-engine.js";

const simulation = {
  snapshotId: "fulcrum-test-snapshot",
  baseline: { equityUsd: 100 },
  result: { equityLossUsd: 40, equityLossFraction: 0.4, liquidationTriggered: false }
};

const exitOptions = [
  {
    id: "reduce-half",
    label: "Reduce 50%",
    exitFraction: 0.5,
    executionCostUsd: 2,
    costEvidence: { status: "scenario_assumption", description: "Test-only cost assumption." }
  },
  {
    id: "exit-all",
    label: "Exit all",
    exitFraction: 1,
    executionCostUsd: 7,
    costEvidence: { status: "observed", description: "Test-only observed route quote." }
  }
];

test("decision frontier reports break-even probabilities without an invented event probability", () => {
  const result = buildDecisionFrontier({ simulation, exitOptions });
  assert.equal(result.eventProbability, null);
  assert.equal(result.options[0].breakEvenProbability, 0.1);
  assert.equal(result.options[1].breakEvenProbability, 0.175);
  assert.equal(result.expectedCostRanking, null);
});

test("decision frontier ranks actions only when a probability is explicitly supplied", () => {
  const result = buildDecisionFrontier({ simulation, exitOptions, eventProbability: 0.25 });
  assert.deepEqual(result.expectedCostRanking, ["reduce-half", "exit-all", "hold"]);
  assert.equal(result.hold.expectedCostUsd, 10);
  assert.equal(result.options[0].expectedCostUsd, 7);
});

test("decision frontier rejects an exit cost without provenance", () => {
  assert.throws(
    () => buildDecisionFrontier({ simulation, exitOptions: [{ id: "bad", label: "Bad", exitFraction: 1, executionCostUsd: 1 }] }),
    /cost evidence/
  );
});

test("observed PT-to-USDC quotes become evidenced exit options", () => {
  const riskSimulation = { ...simulation, baseline: { exitValueUsd: 100 } };
  const options = buildObservedExitOptions({
    snapshotId: "fulcrum-test-snapshot",
    rawInputs: {
      market: { collateral_token: "0x1111111111111111111111111111111111111111", loan_token: "0x2222222222222222222222222222222222222222" },
      position: { state: { collateral: "100000000000000000000" } },
      exitQuotes: [{
        fraction: 0.5,
        input: { token: "0x1111111111111111111111111111111111111111", amount: "50000000000000000000" },
        output: { token: "0x2222222222222222222222222222222222222222", amount: "49000000" },
        minTokenOut: "48500000",
        routeData: { priceImpact: -0.01 },
        request: { slippage: "0.01", tokensIn: "0x1111111111111111111111111111111111111111", tokensOut: "0x2222222222222222222222222222222222222222", amountsIn: "50000000000000000000" }
      }]
    }
  }, riskSimulation);
  assert.equal(options[0].executionCostUsd, 1);
  assert.equal(options[0].minimumProceedsUsd, 48.5);
  assert.equal(options[0].costEvidence.status, "derived");
});

test("mismatched quote token identity withholds a decision quote", () => {
  const riskSimulation = { ...simulation, baseline: { exitValueUsd: 100 } };
  assert.throws(() => buildObservedExitOptions({
    snapshotId: "fulcrum-test-snapshot",
    rawInputs: { market: { collateral_token: "0x1111111111111111111111111111111111111111", loan_token: "0x2222222222222222222222222222222222222222" }, position: { state: { collateral: "100" } }, exitQuotes: [{ fraction: 1, input: { token: "0x1111111111111111111111111111111111111111", amount: "100" }, output: { token: "0x3333333333333333333333333333333333333333", amount: "1" }, minTokenOut: "1", request: { tokensIn: "0x1111111111111111111111111111111111111111", tokensOut: "0x3333333333333333333333333333333333333333", amountsIn: "100" } }] }
  }, riskSimulation), /identity/);
});
