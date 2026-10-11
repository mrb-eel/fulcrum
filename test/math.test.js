import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDropToLiquidation,
  calculateHealthFactor,
  calculateLtv
} from "../src/math.js";

test("calculates the selected position's current LTV", () => {
  const ltv = calculateLtv(3414095.922132792, 3934265.826071008);
  assert.ok(Math.abs(ltv - 0.8678) < 0.0001);
});

test("calculates the selected position's liquidation distance", () => {
  const drop = calculateDropToLiquidation(3414095.922132792, 3934265.826071008, 0.915);
  assert.ok(Math.abs(drop - 0.0516) < 0.0001);
});

test("health factor becomes one at the liquidation boundary", () => {
  const debt = 100;
  const lltv = 0.8;
  const collateralAtLiquidation = debt / lltv;
  assert.equal(calculateHealthFactor(debt, collateralAtLiquidation, lltv), 1);
});
