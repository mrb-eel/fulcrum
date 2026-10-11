import { asPercent } from "./math.js";

const BASIS_SCREEN = 0.005;

function makeStructuralGraph(tomography) {
  return {
    nodes: [
      { id: "ethereum", label: "Ethereum", kind: "settlement", state: "observed" },
      { id: "ethena", label: "Ethena", kind: "yield source", state: "observed" },
      { id: "susde", label: "sUSDe", kind: "yield-bearing dollar", state: "observed" },
      { id: "pt", label: "PT-sUSDe", kind: "position asset", state: "observed" },
      { id: "pendle", label: "Pendle exit market", kind: "escape route", state: "observed" },
      { id: "oracle", label: "Morpho oracle", kind: "collateral valuation", state: "observed" },
      { id: "morpho", label: "Morpho USDC market", kind: "lending constraint", state: "observed" },
      { id: "position", label: "Public position", kind: "economic exposure", state: "observed" }
    ],
    edges: [
      { from: "ethereum", to: "ethena", capability: "access", state: "observed", claim: "Ethena contracts settle on Ethereum." },
      { from: "ethena", to: "susde", capability: "value", state: "observed", claim: "sUSDe is the selected yield-bearing underlying." },
      { from: "susde", to: "pt", capability: "value", state: "observed", claim: "PT-sUSDe derives value from the sUSDe yield source." },
      { from: "pendle", to: "pt", capability: "escape", state: "observed", claim: "Pendle supplies a live PT-to-underlying exit quote." },
      { from: "pt", to: "oracle", capability: "value", state: "observed", claim: "Morpho's oracle values the PT collateral." },
      {
        from: "pendle",
        to: "oracle",
        capability: "value",
        state: tomography.classification,
        claim: "The live values are compared by the tomography experiment; oracle construction remains unproved."
      },
      { from: "oracle", to: "morpho", capability: "value", state: "observed", claim: "The oracle governs collateral valuation in this market." },
      { from: "morpho", to: "position", capability: "access", state: "observed", claim: "The position has a USDC debt against PT collateral." }
    ]
  };
}

export function runOracleTomography({ oraclePriceUsd, ptToUnderlyingRate, underlyingUsdPrice, oracleArchitecture = null }) {
  if (!(oraclePriceUsd > 0 && ptToUnderlyingRate > 0 && underlyingUsdPrice > 0)) {
    throw new Error("Tomography needs positive live oracle, exit-rate, and underlying-price inputs.");
  }

  const pendleExitValueUsd = ptToUnderlyingRate * underlyingUsdPrice;
  const signedBasis = (pendleExitValueUsd - oraclePriceUsd) / oraclePriceUsd;
  const absoluteBasis = Math.abs(signedBasis);
  const isConsistent = absoluteBasis <= BASIS_SCREEN;
  const tracedStaticPrimary = oracleArchitecture?.conclusion?.classification === "confirmed_static_primary_with_usde_aware_backup";
  const classification = tracedStaticPrimary
    ? "direct_exit_dependency_refuted"
    : isConsistent ? "consistent_but_unconfirmed" : "divergent";

  const hypotheses = tracedStaticPrimary
    ? [
        {
          id: "direct-market-aware",
          title: "The current collateral oracle directly uses Pendle exit economics",
          result: "not-supported",
          explanation: "The on-chain trace shows a linear PT discount feed as the active primary path, not a live Pendle AMM exit feed."
        },
        {
          id: "static-linear-primary",
          title: "The current collateral oracle uses a static PT discount path",
          result: "supported",
          explanation: "The deployed primary feed is configured for this PT with a fixed annual discount; the meta-oracle currently selects it."
        },
        {
          id: "usde-aware-backup",
          title: "A USDe/USD-aware backup path exists",
          result: "supported",
          explanation: "The deployed backup combines the PT discount feed with a USDe/USD feed, subject to the meta-oracle's deviation and timelock controls."
        }
      ]
    : isConsistent
    ? [
        {
          id: "market-aware",
          title: "The oracle is aligned with live exit economics",
          result: "supported",
          explanation: "The observed oracle and independently assembled exit value are within the screening band."
        },
        {
          id: "static-face-value",
          title: "The oracle ignores current exit discount",
          result: "not-supported",
          explanation: "A material gap would be expected if the oracle held a stale face value while the market discounted PT."
        },
        {
          id: "independent-source",
          title: "Both values happen to agree through a separate source",
          result: "unresolved",
          explanation: "Price agreement does not disclose the oracle implementation or prove causation."
        }
      ]
    : [
        {
          id: "market-aware",
          title: "The oracle is aligned with live exit economics",
          result: "not-supported",
          explanation: "The observed gap exceeds the screening band and deserves immediate review."
        },
        {
          id: "static-face-value",
          title: "The oracle ignores current exit discount",
          result: "plausible",
          explanation: "A persistent gap can be consistent with a valuation that does not use the exit route."
        },
        {
          id: "independent-source",
          title: "Both values use different sources or timing",
          result: "plausible",
          explanation: "A timing difference, conversion convention, or independent feed can also explain the gap."
        }
      ];

  const result = {
    method: "Live three-way valuation triangulation",
    purpose: "Try to falsify the claim that the collateral oracle is economically aligned with the live PT exit route.",
    inputs: {
      oraclePriceUsd,
      ptToUnderlyingRate,
      underlyingUsdPrice,
      pendleExitValueUsd: Number(pendleExitValueUsd.toFixed(8)),
      signedBasisPercent: asPercent(signedBasis, 3),
      absoluteBasisBps: Number((absoluteBasis * 10_000).toFixed(2)),
      screeningBandBps: BASIS_SCREEN * 10_000
    },
    classification,
    conclusion: tracedStaticPrimary
      ? "The prices are close at this read, but the causal trace refutes a direct live-exit oracle dependency. The immediate risk is a valuation-versus-escape wedge: Pendle exit liquidity can worsen before the current primary collateral oracle changes."
      : isConsistent
      ? "The live values are economically consistent at this read. This supports an exposure hypothesis, but does not prove how the oracle is built."
      : "The live values materially diverge at this read. FULCRUM flags a valuation-basis investigation before treating the collateral value as exitable value.",
    hypotheses,
    nextInvestigation: tracedStaticPrimary
      ? {
          title: "Monitor the meta-oracle challenge path",
          reason: "The remaining decision-relevant uncertainty is when a deviation persists long enough to move from the current primary to the USDe/USD-aware backup.",
          status: "queued",
          whyNotHistoricalCorrelation: "The question is now a contract state transition, not a correlation question."
        }
      : {
          title: "Inspect the oracle implementation and deployment trail",
          reason: "This is the smallest next observation that can distinguish direct market-aware construction from coincidental price agreement.",
          status: "queued",
          whyNotHistoricalCorrelation: "Correlation can show shared movement but cannot identify the oracle’s input path."
        },
    limitations: [
      "The test is one timestamped observation, not a causal proof.",
      "The sUSDe USD reference and Pendle quote can have different update times.",
      "The 50-basis-point band is a transparent screening rule, not a protocol guarantee."
    ]
  };

  return { ...result, graph: makeStructuralGraph(result) };
}
