import test from "node:test";
import assert from "node:assert/strict";
import { findCriticalShock, simulatePosition } from "../src/risk-engine.js";

const snapshot = {
  snapshotId: "fulcrum-test-snapshot",
  caseDefinition: { chainId: 1 },
  rawInputs: {
    position: { state: { collateral: "100000000000000000000", collateralUsd: 100, borrowAssetsUsd: 70 } },
    market: { lltv_wad: "800000000000000000" },
    oracle: { price: "1000000000000000000000000" },
    pendleSwap: { ptToUnderlyingTokenRate: 1 },
    underlyingPrice: { price: 1 }
  }
};

test("a zero shock preserves the snapshot's economic and lending state", () => {
  const result = simulatePosition(snapshot);
  assert.equal(result.result.equityLossUsd, 0);
  assert.equal(result.result.economicEquityUsd, 30);
  assert.equal(result.result.ltv, 0.7);
  assert.equal(result.result.liquidationTriggered, false);
});

test("separate value and escape shocks compound without double counting", () => {
  const result = simulatePosition(snapshot, { underlyingHaircut: 0.1, exitDiscount: 0.1 });
  assert.equal(result.result.economicExitValueUsd, 81);
  assert.equal(result.result.equityLossUsd, 19);
  assert.ok(Math.abs(result.result.equityLossFraction - 19 / 30) < 1e-8);
  assert.ok(Math.abs(result.result.interactionLossFraction + 1 / 30) < 1e-8);
});

test("oracle transmission is explicit and controls the liquidation path", () => {
  const aligned = simulatePosition(snapshot, { underlyingHaircut: 0.2, oracleTransmission: 1 });
  const stale = simulatePosition(snapshot, { underlyingHaircut: 0.2, oracleTransmission: 0 });
  assert.equal(aligned.result.liquidationTriggered, true);
  assert.equal(stale.result.liquidationTriggered, false);
  assert.equal(aligned.result.equityLossUsd, stale.result.equityLossUsd);
});

test("a traced static primary does not silently inherit exit-liquidity shocks", () => {
  const tracedSnapshot = {
    ...snapshot,
    rawInputs: {
      ...snapshot.rawInputs,
      oracleInvestigation: {
        conclusion: { classification: "confirmed_static_primary_with_usde_aware_backup" }
      }
    }
  };
  const result = simulatePosition(tracedSnapshot, { underlyingHaircut: 0.2, exitDiscount: 0.2 });
  assert.equal(result.assumptions.oracleMode, "observed-current-primary");
  assert.equal(result.assumptions.oracleExitTransmission, 0);
  assert.equal(result.result.oracleCollateralUsd, 100);
  assert.equal(result.result.liquidationTriggered, false);
});

test("critical-shock search returns the least-severe qualifying grid point", () => {
  const result = findCriticalShock(snapshot, {
    lossLimit: 1 / 3,
    underlyingHaircuts: [0, 0.05, 0.1, 0.2],
    exitDiscounts: [0, 0.05, 0.1, 0.2]
  });
  assert.equal(result.critical.underlyingHaircut, 0);
  assert.equal(result.critical.exitDiscount, 0.1);
  assert.ok(Math.abs(result.critical.simulation.result.equityLossFraction - 1 / 3) < 1e-9);
});

test("loan health uses oracle price and native debt, not an unrelated USD collateral mark", () => {
  const marked = structuredClone(snapshot);
  marked.rawInputs.position.state.collateralUsd = 200;
  marked.rawInputs.position.state.borrowAssets = "70000000";
  const result = simulatePosition(marked, { oracleTransmission: 0 });
  assert.equal(result.baseline.oracleCollateralLoan, 100);
  assert.equal(result.baseline.ltv, .7);
  assert.ok(Math.abs(result.baseline.healthFactor - 80/70) < 1e-7);
});
