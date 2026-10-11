import { CASE } from "./case-config.js";
import { buildSelectedCaseGraph } from "./core/dependency-graph.js";
import { createEvidenceSnapshot } from "./core/snapshot.js";
import { decimalStringToNumber } from "./math.js";
import { runOracleTomography } from "./tomography.js";

const MORPHO = "https://api.morpho.org";
const PENDLE = "https://api-v2.pendle.finance/core";

function source(provider, url) {
  return { provider, url };
}

export function createLiveEvidenceSnapshot(inputs, observedAt) {
  // Morpho's oracle is PT denominated in the loan asset (USDC), not USD.
  // Convert it through the contemporaneous loan-asset USD mark before any
  // three-way USD comparison. Native health calculations stay in USDC.
  const oraclePriceLoan = decimalStringToNumber(inputs.oracle.price, 24);
  const loanDebt = decimalStringToNumber(inputs.position.state.borrowAssets, 6);
  const loanUsd = Number(inputs.position.state.borrowAssetsUsd) / loanDebt;
  const oraclePriceUsd = oraclePriceLoan * loanUsd;
  const tomography = runOracleTomography({
    oraclePriceUsd,
    ptToUnderlyingRate: inputs.pendleSwap.ptToUnderlyingTokenRate,
    underlyingUsdPrice: Number(inputs.underlyingPrice.price),
    oracleArchitecture: inputs.oracleInvestigation
  });

  const evidence = [
    {
      id: "settlement-chain",
      claim: "The selected contracts and position are on Ethereum.",
      status: "observed",
      observedAt,
      sources: [source("Morpho public API", `${MORPHO}/v0/blue/markets/${CASE.chainId}:${CASE.marketId}`)]
    },
    {
      id: "yield-source",
      claim: "Pendle labels the selected PT market's external protocol as Ethena.",
      status: "observed",
      observedAt,
      sources: [source("Pendle Core API", `${PENDLE}/v2/markets/all`)],
      observation: {
        protocol: inputs.pendleMarket.protocol,
        underlyingAsset: inputs.pendleMarket.underlyingAsset,
        expiry: inputs.pendleMarket.expiry
      }
    },
    {
      id: "pt-underlying",
      claim: "The selected PT uses sUSDe as its underlying asset.",
      status: "observed",
      observedAt,
      sources: [source("Pendle Core API", `${PENDLE}/v1/sdk/${CASE.chainId}/markets/${CASE.pendleMarket}/swapping-prices`)]
    },
    {
      id: "pendle-exit-quote",
      claim: "Pendle returned live routes to convert 25%, 50%, and 100% of the observed PT collateral to USDC.",
      status: "observed",
      observedAt,
      sources: [source("Pendle Hosted SDK", `${PENDLE}/v2/sdk/${CASE.chainId}/convert`)],
      observation: {
        ptToUnderlyingRate: inputs.pendleSwap.ptToUnderlyingTokenRate,
        quotes: inputs.exitQuotes
      },
      limitation: "Quote outputs are read-only estimates. The quoted route includes current price impact and protocol fee data but no USD gas estimate."
    },
    {
      id: "morpho-oracle",
      claim: "Morpho exposes a live PT oracle value denominated in the market's loan asset.",
      status: "observed",
      observedAt,
      sources: [source("Morpho public API", `${MORPHO}/v0/oracles/${CASE.chainId}:${CASE.oracle}/state`)],
      observation: { oraclePriceLoan, loanUsd, oraclePriceUsd }
    },
    {
      id: "oracle-architecture",
      claim: "The selected oracle trace and its current configuration were recorded. Any topology claim is conditional on the trace classification below.",
      status: "observed",
      observedAt,
      sources: [
        source("Ethereum JSON-RPC", inputs.oracleInvestigation.rpc),
        source("Blockscout verified-source API", "https://eth.blockscout.com/api?module=contract&action=getsourcecode")
      ],
      observation: inputs.oracleInvestigation
    },
    {
      id: "morpho-collateral-rule",
      claim: "Morpho accepts PT-sUSDe as collateral for USDC with the observed LLTV.",
      status: "observed",
      observedAt,
      sources: [source("Morpho public API", `${MORPHO}/v0/blue/markets/${CASE.chainId}:${CASE.marketId}`)],
      observation: { lltvWad: inputs.market.lltv_wad }
    },
    {
      id: "public-position-state",
      claim: "The selected public address has observed PT collateral and USDC debt in the market.",
      status: "observed",
      observedAt,
      sources: [source("Morpho public GraphQL API", `${MORPHO}/graphql`)],
      observation: inputs.position.state
    },
    {
      id: "oracle-exit-tomography",
      claim: "The live oracle and exit values are close at this observation, but the current primary oracle does not directly consume Pendle's live exit price.",
      status: "derived",
      observedAt,
      sources: [
        source("Morpho oracle API", `${MORPHO}/v0/oracles/${CASE.chainId}:${CASE.oracle}/state`),
        source("Pendle swap-price API", `${PENDLE}/v1/sdk/${CASE.chainId}/markets/${CASE.pendleMarket}/swapping-prices`),
        source("Morpho asset-price API", `${MORPHO}/v0/tokens/${CASE.chainId}:${CASE.underlyingToken}/price`)
      ],
      inputs: ["morpho-oracle", "pendle-exit-quote", "oracle-architecture"],
      observation: tomography.inputs,
      limitation: "The trace establishes the present on-chain configuration. It does not predict whether or when a governance or timelock action will change the active oracle."
    }
  ];

  const snapshot = createEvidenceSnapshot({
    caseDefinition: {
      name: "Leveraged PT-sUSDe / USDC position",
      chainId: CASE.chainId,
      position: CASE.publicPosition,
      marketId: CASE.marketId,
      pendleMarket: CASE.pendleMarket,
      expiry: CASE.expiry
    },
    observedAt,
    rawInputs: inputs,
    evidence
  });
  const graph = buildSelectedCaseGraph({
    ledger: snapshot.ledger,
    oracleExitState: inputs.oracleInvestigation.conclusion.classification
  });
  return { snapshot, graph, tomography };
}
