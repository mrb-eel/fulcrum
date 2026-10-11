import { decimalStringToNumber } from "./math.js";

const EPSILON = 1e-12;

function assertFraction(name, value) {
  if (!(Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new Error(`${name} must be a number between zero and one.`);
  }
}

function assertFiniteNonNegative(name, value) {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new Error(`${name} must be a non-negative number.`);
  }
}

function round(value, decimals = 8) {
  return Number(value.toFixed(decimals));
}

const ZERO = "0x0000000000000000000000000000000000000000";
const sameAddress = (left, right) => typeof left === "string" && typeof right === "string" && left.toLowerCase() === right.toLowerCase();

function validatedQuote(snapshot, quote) {
  const market = snapshot.rawInputs?.market;
  const total = BigInt(snapshot.rawInputs?.position?.state?.collateral ?? "0");
  const input = BigInt(quote?.input?.amount ?? "0");
  const requested = BigInt(quote?.request?.amountsIn ?? "0");
  const output = BigInt(quote?.output?.amount ?? "0");
  const minimum = BigInt(quote?.minTokenOut ?? "0");
  if (!(total > 0n && input > 0n && input <= total && input === requested && output > 0n && minimum > 0n && minimum <= output)) {
    throw new Error("Quote has inconsistent collateral or output amounts.");
  }
  if (!sameAddress(quote.input?.token, market?.collateral_token) || !sameAddress(quote.request?.tokensIn, market?.collateral_token) || !sameAddress(quote.output?.token, market?.loan_token) || !sameAddress(quote.request?.tokensOut, market?.loan_token) || sameAddress(market?.loan_token, ZERO)) {
    throw new Error("Quote asset identity does not match this collateral and loan market.");
  }
  const exitFraction = Number(input) / Number(total);
  if (!(Number.isFinite(exitFraction) && exitFraction > 0 && exitFraction <= 1) || Math.abs(Number(quote.fraction) - exitFraction) > 1e-10) {
    throw new Error("Quote fraction does not match its recorded native amount.");
  }
  return { exitFraction, output, minimum };
}

/** Builds directly usable decision options from saved Pendle PT-to-USDC quotes. */
export function buildObservedExitOptions(snapshot, simulation) {
  if (snapshot?.snapshotId !== simulation?.snapshotId) {
    throw new Error("Exit quotes and risk simulation must come from the same snapshot.");
  }
  const quotes = snapshot.rawInputs?.exitQuotes;
  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new Error("The snapshot has no observed Pendle PT-to-USDC quotes.");
  }
  return quotes.map((quote) => {
    const { exitFraction, output, minimum } = validatedQuote(snapshot, quote);
    const loanUsdPrice = simulation.baseline.loanDebt ? simulation.baseline.debtUsd / simulation.baseline.loanDebt : 1;
    const quotedProceedsUsd = decimalStringToNumber(output.toString(), 6) * loanUsdPrice;
    const minimumProceedsUsd = decimalStringToNumber(minimum.toString(), 6) * loanUsdPrice;
    if (!(Number.isFinite(quotedProceedsUsd) && quotedProceedsUsd >= 0)) throw new Error("Quote has no usable output amount.");
    const referenceExitValueUsd = simulation.baseline.exitValueUsd * exitFraction;
    const executionCostUsd = referenceExitValueUsd - quotedProceedsUsd;
    if (!(executionCostUsd >= -EPSILON)) {
      throw new Error("Quote output exceeds its reference exit value; inspect valuation basis before using it as an execution cost.");
    }
    const percent = Math.round(exitFraction * 100);
    return Object.freeze({
      id: `exit-${percent}`,
      label: `Exit ${percent}%`,
      exitFraction,
      executionCostUsd: Math.max(0, executionCostUsd),
      quotedProceedsUsd,
      minimumProceedsUsd,
      costEvidence: Object.freeze({
        status: "derived",
        description: `Reference value less the recorded ${percent}% PT-to-USDC quote, using the position's implied USDC/USD rate. Minimum received is recorded separately from the quote. Includes quoted route impact; excludes gas, funding, loan unwind and carry.`,
        source: "Pendle Hosted SDK convert API",
        request: quote.request
      })
    });
  });
}

/**
 * Compares hold / partial reduction / exit against a conditional loss result.
 * It returns probability thresholds rather than manufacturing failure odds.
 */
export function buildDecisionFrontier({
  simulation,
  exitOptions,
  eventProbability = null
}) {
  if (!simulation?.snapshotId || !simulation?.baseline || !simulation?.result) {
    throw new Error("Decision analysis requires a completed FULCRUM risk simulation.");
  }
  if (!Array.isArray(exitOptions) || exitOptions.length === 0) {
    throw new Error("Decision analysis requires at least one documented exit option.");
  }
  if (eventProbability !== null) assertFraction("Event probability", eventProbability);

  const conditionalLossUsd = simulation.result.equityLossUsd;
  assertFiniteNonNegative("Conditional loss", conditionalLossUsd);
  const options = exitOptions.map((option) => {
    const exitFraction = option.exitFraction;
    const executionCostUsd = option.executionCostUsd;
    assertFraction(`Exit fraction for ${option.id ?? "option"}`, exitFraction);
    assertFiniteNonNegative(`Execution cost for ${option.id ?? "option"}`, executionCostUsd);
    if (!option.id || !option.label || !option.costEvidence?.status || !option.costEvidence?.description) {
      throw new Error("Each exit option needs an id, label, and explicit cost evidence status and description.");
    }

    const avoidedConditionalLossUsd = conditionalLossUsd * exitFraction;
    const residualConditionalLossUsd = conditionalLossUsd - avoidedConditionalLossUsd;
    const breakEvenProbability = avoidedConditionalLossUsd > EPSILON
      ? executionCostUsd / avoidedConditionalLossUsd
      : null;
    const expectedCostUsd = eventProbability === null
      ? null
      : executionCostUsd + eventProbability * residualConditionalLossUsd;
    const beatsHoldAtProbability = breakEvenProbability === null
      ? null
      : breakEvenProbability <= 1 ? breakEvenProbability : null;

    return Object.freeze({
      id: option.id,
      label: option.label,
      exitFraction,
      executionCostUsd: round(executionCostUsd, 2),
      costEvidence: Object.freeze({ ...option.costEvidence }),
      avoidedConditionalLossUsd: round(avoidedConditionalLossUsd, 2),
      residualConditionalLossUsd: round(residualConditionalLossUsd, 2),
      breakEvenProbability: breakEvenProbability === null ? null : round(breakEvenProbability, 8),
      beatsHoldAtProbability: beatsHoldAtProbability === null ? null : round(beatsHoldAtProbability, 8),
      expectedCostUsd: expectedCostUsd === null ? null : round(expectedCostUsd, 2),
      interpretation: breakEvenProbability === null
        ? "This option does not reduce exposure."
        : breakEvenProbability > 1
          ? "The observed or assumed exit cost exceeds the conditional loss it avoids."
          : "Reducing exposure is cheaper than holding if the event probability exceeds this break-even threshold."
    });
  });

  const hold = Object.freeze({
    id: "hold",
    label: "Hold",
    exitFraction: 0,
    executionCostUsd: 0,
    residualConditionalLossUsd: round(conditionalLossUsd, 2),
    expectedCostUsd: eventProbability === null ? null : round(eventProbability * conditionalLossUsd, 2)
  });
  const expectedCostRanking = eventProbability === null
    ? null
    : Object.freeze([hold, ...options]
      .slice()
      .sort((a, b) => a.expectedCostUsd - b.expectedCostUsd)
      .map((option) => option.id));

  return Object.freeze({
    schemaVersion: "fulcrum-decision-frontier/v1",
    snapshotId: simulation.snapshotId,
    conditionalScenario: Object.freeze({
      equityLossUsd: conditionalLossUsd,
      equityLossFraction: simulation.result.equityLossFraction,
      liquidationTriggered: simulation.result.liquidationTriggered
    }),
    eventProbability,
    hold,
    options: Object.freeze(options),
    expectedCostRanking,
    recommendation: eventProbability === null
      ? "No unconditional action recommendation: use the break-even probabilities until a defensible event probability is supplied."
      : `The ranking uses the supplied event probability of ${(eventProbability * 100).toFixed(2)}%, not a FULCRUM probability forecast.`,
    limitation: "Indicative quote-only comparison. Assumes a feasible proportional reduction before the shock; omits gas, financing, debt-unwind costs and foregone carry. A spot swap quote does not prove collateral can be withdrawn and sold."
  });
}
