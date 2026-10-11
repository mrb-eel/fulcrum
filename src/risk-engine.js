import {
  calculateHealthFactor,
  calculateLtv,
  decimalStringToNumber
} from "./math.js";

const EPSILON = 1e-12;
const DEFAULT_GRID = Object.freeze([0, 0.0025, 0.005, 0.01, 0.02, 0.03, 0.05, 0.075, 0.1, 0.15, 0.2, 0.3]);

function assertFraction(name, value) {
  if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error(`${name} must be a number between zero and one.`);
  }
}

function round(value, decimals = 8) {
  return Number(value.toFixed(decimals));
}

function numericSnapshot(snapshot) {
  if (!snapshot?.rawInputs || !snapshot?.caseDefinition) {
    throw new Error("Risk simulation requires a FULCRUM evidence snapshot.");
  }
  const { rawInputs } = snapshot;
  const position = rawInputs.position?.state;
  const values = {
    collateralUsd: Number(position?.collateralUsd),
    debtUsd: Number(position?.borrowAssetsUsd),
    collateralPt: decimalStringToNumber(position?.collateral, 18),
    lltv: Number(rawInputs.market?.lltv_wad) / 1e18,
    oraclePriceUsd: decimalStringToNumber(rawInputs.oracle?.price, 24),
    ptToUnderlyingRate: Number(rawInputs.pendleSwap?.ptToUnderlyingTokenRate),
    underlyingUsdPrice: Number(rawInputs.underlyingPrice?.price)
  };
  for (const [name, value] of Object.entries(values)) {
    if (!(Number.isFinite(value) && value > 0)) {
      throw new Error(`Snapshot has no usable positive ${name}.`);
    }
  }
  if (values.lltv > 1) throw new Error("Snapshot LLTV cannot exceed one.");
  // Morpho health is measured in loan-token units. API USD market marks are a
  // different valuation basis and must not substitute for the deployed oracle.
  values.loanDebt = position.borrowAssets === undefined
    ? values.debtUsd : decimalStringToNumber(position.borrowAssets, 6);
  if (!(Number.isFinite(values.loanDebt) && values.loanDebt > 0)) throw new Error("Snapshot has no usable loan balance.");
  values.oracleCollateralLoan = values.collateralPt * values.oraclePriceUsd;
  values.collateralUsd = values.oracleCollateralLoan * (values.debtUsd / values.loanDebt);
  return values;
}

function resolveOracleResponse(snapshot, shock) {
  const tracedPrimary = snapshot.rawInputs?.oracleInvestigation?.conclusion?.classification === "confirmed_static_primary_with_usde_aware_backup";
  const oracleMode = shock.oracleMode ?? (tracedPrimary ? "observed-current-primary" : "custom-counterfactual");
  if (!["observed-current-primary", "backup-after-timelock", "custom-counterfactual"].includes(oracleMode)) throw new Error("Unknown oracle mode.");
  if (oracleMode === "observed-current-primary") {
    if (snapshot.rawInputs?.oracleInvestigation?.oracle?.isPrimary === false) throw new Error("The observed oracle no longer selects the primary feed.");
    return {
      oracleMode,
      underlyingTransmission: 0,
      exitTransmission: 0,
      meaning: "The traced current primary is a static linear PT discount path. This conditional scenario does not assume that live exit liquidity or the underlying USD reference moves it."
    };
  }
  if (oracleMode === "backup-after-timelock") {
    return {
      oracleMode,
      underlyingTransmission: 1,
      exitTransmission: 0,
      meaning: "Conditional counterfactual: the USDe/USD-aware backup is active after its documented deviation and timelock process. Live Pendle exit discount still does not directly transmit."
    };
  }
  const transmission = shock.oracleTransmission ?? 1;
  assertFraction("Oracle transmission", transmission);
  return {
    oracleMode: "custom-counterfactual",
    underlyingTransmission: shock.oracleUnderlyingTransmission ?? transmission,
    exitTransmission: shock.oracleExitTransmission ?? transmission,
    meaning: "User-specified counterfactual. It is not inferred from the current oracle trace."
  };
}

/**
 * Sends explicitly-labelled conditional shocks through value, exit, and lending
 * valuation paths. It does not assign probabilities or invent liquidation fees.
 */
export function simulatePosition(snapshot, shock = {}) {
  const baseline = numericSnapshot(snapshot);
  const underlyingHaircut = shock.underlyingHaircut ?? 0;
  const exitDiscount = shock.exitDiscount ?? 0;
  const oracleResponse = resolveOracleResponse(snapshot, shock);
  assertFraction("Underlying haircut", underlyingHaircut);
  assertFraction("Exit discount", exitDiscount);
  assertFraction("Oracle underlying transmission", oracleResponse.underlyingTransmission);
  assertFraction("Oracle exit transmission", oracleResponse.exitTransmission);

  const exitValuePerPt = baseline.ptToUnderlyingRate * baseline.underlyingUsdPrice;
  const baselineExitValueUsd = baseline.collateralPt * exitValuePerPt;
  const baselineEquityUsd = baselineExitValueUsd - baseline.debtUsd;
  if (!(baselineEquityUsd > EPSILON)) {
    throw new Error("The snapshot does not have positive exit-value equity to stress.");
  }

  // The product prevents the same collateral loss from being counted twice.
  const underlyingUsdPrice = baseline.underlyingUsdPrice * (1 - underlyingHaircut);
  const ptToUnderlyingRate = baseline.ptToUnderlyingRate * (1 - exitDiscount);
  const exitValuePerPtAfterShock = ptToUnderlyingRate * underlyingUsdPrice;
  const scenarioExitValueUsd = baseline.collateralPt * exitValuePerPtAfterShock;
  const oraclePriceUsd = baseline.oraclePriceUsd
    * (1 - oracleResponse.underlyingTransmission * underlyingHaircut)
    * (1 - oracleResponse.exitTransmission * exitDiscount);
  const oracleCollateralUsd = baseline.collateralUsd * (oraclePriceUsd / baseline.oraclePriceUsd);
  const ltv = calculateLtv(baseline.debtUsd, oracleCollateralUsd);
  const healthFactor = calculateHealthFactor(baseline.debtUsd, oracleCollateralUsd, baseline.lltv);
  const scenarioEquityUsd = scenarioExitValueUsd - baseline.debtUsd;
  const equityLossUsd = Math.max(0, baselineEquityUsd - scenarioEquityUsd);
  const equityLossFraction = equityLossUsd / baselineEquityUsd;
  const underlyingOnly = underlyingHaircut * baselineExitValueUsd / baselineEquityUsd;
  const exitOnly = exitDiscount * baselineExitValueUsd / baselineEquityUsd;

  return Object.freeze({
    schemaVersion: "fulcrum-risk-simulation/v1",
    snapshotId: snapshot.snapshotId,
    assumptions: Object.freeze({
      underlyingHaircut,
      exitDiscount,
      oracleMode: oracleResponse.oracleMode,
      oracleUnderlyingTransmission: oracleResponse.underlyingTransmission,
      oracleExitTransmission: oracleResponse.exitTransmission,
      oracleTransmissionMeaning: oracleResponse.meaning,
      liquidationCostMode: "not_modelled"
    }),
    baseline: Object.freeze({
      collateralPt: round(baseline.collateralPt),
      loanDebt: round(baseline.loanDebt, 6),
      oracleCollateralLoan: round(baseline.oracleCollateralLoan, 6),
      debtUsd: round(baseline.debtUsd, 2),
      exitValueUsd: round(baselineExitValueUsd, 2),
      equityUsd: round(baselineEquityUsd, 2),
      oracleCollateralUsd: round(baseline.collateralUsd, 2),
      ltv: round(calculateLtv(baseline.debtUsd, baseline.collateralUsd)),
      healthFactor: round(calculateHealthFactor(baseline.debtUsd, baseline.collateralUsd, baseline.lltv))
    }),
    result: Object.freeze({
      underlyingUsdPrice: round(underlyingUsdPrice),
      ptToUnderlyingRate: round(ptToUnderlyingRate),
      economicExitValueUsd: round(scenarioExitValueUsd, 2),
      economicEquityUsd: round(scenarioEquityUsd, 2),
      equityLossUsd: round(equityLossUsd, 2),
      equityLossFraction: round(equityLossFraction, 12),
      oraclePriceUsd: round(oraclePriceUsd),
      oracleCollateralUsd: round(oracleCollateralUsd, 2),
      ltv: round(ltv),
      healthFactor: round(healthFactor),
      liquidationTriggered: healthFactor <= 1 + EPSILON,
      interactionLossFraction: round(equityLossFraction - underlyingOnly - exitOnly, 12),
      limitation: "Loss is a conditional change in reference equity. The reference rate is not a size-specific sale quote. Liquidation charges, gas, carry, and the path needed to unwind the loan are excluded."
    }),
    propagation: Object.freeze([
      Object.freeze({ ray: "value", mechanism: "Underlying USD reference", formula: "underlying price × (1 − underlying haircut)", output: underlyingUsdPrice }),
      Object.freeze({ ray: "escape", mechanism: "PT exit conversion", formula: "PT→underlying rate × (1 − exit discount)", output: ptToUnderlyingRate }),
      Object.freeze({ ray: "economic value", mechanism: "Modelled collateral reference value", formula: "PT quantity × shocked PT→underlying rate × shocked underlying USD price", output: scenarioExitValueUsd }),
      Object.freeze({ ray: "lending valuation", mechanism: "Traced oracle response", formula: "oracle price × (1 − underlying transmission × underlying haircut) × (1 − exit transmission × exit discount)", output: oraclePriceUsd }),
      Object.freeze({ ray: "constraint", mechanism: "Morpho collateral health", formula: "(oracle collateral value × LLTV) / debt", output: healthFactor })
    ])
  });
}

/** Finds the least severe qualifying point on a declared finite grid. */
export function findCriticalShock(snapshot, {
  lossLimit = 0.1,
  oracleMode = undefined,
  oracleTransmission = undefined,
  underlyingHaircuts = DEFAULT_GRID,
  exitDiscounts = DEFAULT_GRID
} = {}) {
  assertFraction("Loss limit", lossLimit);
  if (oracleTransmission !== undefined) assertFraction("Oracle transmission", oracleTransmission);
  const candidates = [];
  for (const underlyingHaircut of underlyingHaircuts) {
    for (const exitDiscount of exitDiscounts) {
      const simulation = simulatePosition(snapshot, { underlyingHaircut, exitDiscount, oracleMode, oracleTransmission });
      if (simulation.result.equityLossFraction + EPSILON < lossLimit) continue;
      candidates.push({
        severity: underlyingHaircut + exitDiscount,
        maxComponent: Math.max(underlyingHaircut, exitDiscount),
        underlyingHaircut,
        exitDiscount,
        simulation
      });
    }
  }
  candidates.sort((a, b) => a.severity - b.severity || a.maxComponent - b.maxComponent || a.underlyingHaircut - b.underlyingHaircut || a.exitDiscount - b.exitDiscount);
  const critical = candidates[0] ?? null;
  return Object.freeze({
    schemaVersion: "fulcrum-critical-shock-search/v1",
    snapshotId: snapshot.snapshotId,
    lossLimit,
    oracleMode: oracleMode ?? "snapshot-default",
    oracleTransmission: oracleTransmission ?? null,
    searchSpace: Object.freeze({
      underlyingHaircuts: Object.freeze([...underlyingHaircuts]),
      exitDiscounts: Object.freeze([...exitDiscounts]),
      candidatesEvaluated: underlyingHaircuts.length * exitDiscounts.length,
      severityFormula: "underlying haircut + exit discount"
    }),
    critical: critical && Object.freeze({
      underlyingHaircut: critical.underlyingHaircut,
      exitDiscount: critical.exitDiscount,
      severity: critical.severity,
      simulation: critical.simulation
    }),
    limitation: "The answer is the least severe combination inside this declared grid. It is not a probability forecast or a claim about unmodelled liquidation costs."
  });
}
