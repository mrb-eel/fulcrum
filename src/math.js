export function asPercent(value, decimals = 2) {
  return Number((value * 100).toFixed(decimals));
}

export function calculateLtv(debtUsd, collateralUsd) {
  if (!(debtUsd >= 0) || !(collateralUsd > 0)) {
    throw new Error("Debt must be non-negative and collateral must be positive.");
  }
  return debtUsd / collateralUsd;
}

export function calculateHealthFactor(debtUsd, collateralUsd, lltv) {
  if (!(lltv > 0 && lltv <= 1)) {
    throw new Error("LLTV must be between zero and one.");
  }
  if (!(debtUsd > 0)) {
    return Number.POSITIVE_INFINITY;
  }
  return (collateralUsd * lltv) / debtUsd;
}

export function calculateDropToLiquidation(debtUsd, collateralUsd, lltv) {
  const healthFactor = calculateHealthFactor(debtUsd, collateralUsd, lltv);
  return Math.max(0, 1 - 1 / healthFactor);
}

export function decimalStringToNumber(value, decimals) {
  const raw = BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  return Number(whole) + Number(fraction) / Number(divisor);
}
