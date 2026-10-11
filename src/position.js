import { CASE } from "./case-config.js";
import {
  asPercent,
  calculateDropToLiquidation,
  calculateHealthFactor,
  calculateLtv,
  decimalStringToNumber
} from "./math.js";
import { runOracleTomography } from "./tomography.js";

export function buildPositionSnapshot({ position, market, marketState, oracle, pendleSwap, underlyingPrice, oracleInvestigation }, observedAt) {
  const lltv = Number(market.lltv_wad) / 1e18;
  const collateralUsd = Number(position.state.collateralUsd);
  const debtUsd = Number(position.state.borrowAssetsUsd);
  // Morpho's price is scaled by 10^(36 + USDC decimals - PT decimals) = 10^24.
  const collateralPt = decimalStringToNumber(position.state.collateral, 18);
  const debtUsdc = decimalStringToNumber(position.state.borrowAssets, 6);
  const oraclePriceUsdc = decimalStringToNumber(oracle.price, 24);
  const oracleCollateralUsdc = collateralPt * oraclePriceUsdc;
  const oraclePriceUsd = oraclePriceUsdc * debtUsd / debtUsdc;
  const ltv = calculateLtv(debtUsdc, oracleCollateralUsdc);
  const healthFactor = calculateHealthFactor(debtUsdc, oracleCollateralUsdc, lltv);
  const dropToLiquidation = calculateDropToLiquidation(debtUsdc, oracleCollateralUsdc, lltv);
  const tomography = runOracleTomography({
    oraclePriceUsd,
    ptToUnderlyingRate: pendleSwap.ptToUnderlyingTokenRate,
    underlyingUsdPrice: Number(underlyingPrice.price),
    oracleArchitecture: oracleInvestigation
  });

  return {
    observedAt,
    case: {
      name: "Leveraged PT-sUSDe / USDC position",
      chain: CASE.chainName,
      positionAddress: CASE.publicPosition,
      positionAddressShort: `${CASE.publicPosition.slice(0, 6)}…${CASE.publicPosition.slice(-4)}`,
      pendleMarket: CASE.pendleMarket,
      morphoMarket: CASE.marketId,
      expiry: CASE.expiry
    },
    observed: {
      collateral: {
        symbol: CASE.collateralSymbol,
        amount: collateralPt,
        usd: collateralUsd
      },
      debt: {
        symbol: CASE.loanSymbol,
        amount: debtUsdc,
        usd: debtUsd
      },
      loanToValue: asPercent(ltv),
      liquidationLtv: asPercent(lltv),
      healthFactor: Number(healthFactor.toFixed(4)),
      priceDropToLiquidation: asPercent(dropToLiquidation),
      oraclePriceUsd: Number(oraclePriceUsd.toFixed(6)),
      oraclePriceUsdc: Number(oraclePriceUsdc.toFixed(6)),
      oracleLastIndexedBlock: oracle.last_indexed_block,
      underlyingUsdPrice: Number(underlyingPrice.price.toFixed(6)),
      availableLoanLiquidity:
        decimalStringToNumber(marketState.total_supply_assets, 6) -
        decimalStringToNumber(marketState.total_borrow_assets, 6),
      pendle: {
        ptToUnderlyingRate: pendleSwap.ptToUnderlyingTokenRate,
        underlyingToPtRate: pendleSwap.underlyingTokenToPtRate,
        impliedApy: asPercent(pendleSwap.impliedApy)
      }
    },
    evidence: [
      {
        claim: "PT-sUSDe is accepted as collateral for a USDC loan.",
        status: "observed",
        source: "Morpho market configuration",
        url: `https://api.morpho.org/v0/blue/markets/${CASE.chainId}:${CASE.marketId}`
      },
      {
        claim: "The selected address currently has collateral and debt in this market.",
        status: "observed",
        source: "Morpho public GraphQL API",
        url: "https://api.morpho.org/graphql"
      },
      {
        claim: tomography.classification === "direct_exit_dependency_refuted"
          ? "The traced primary feed does not read the live Pendle sale price."
          : "Price agreement alone does not identify the oracle's input route.",
        status: tomography.classification === "direct_exit_dependency_refuted" ? "derived" : "inference_to_test",
        source: "Morpho oracle state, contract trace and Pendle reference price",
        url: `https://api.morpho.org/v0/oracles/${CASE.chainId}:${CASE.oracle}/state`
      }
    ],
    tomography
  };
}
