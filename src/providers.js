import { CASE } from "./case-config.js";
import { investigateSelectedOracle } from "./oracle-investigation.js";
import { fetchJson } from "./http-client.js";

const MORPHO_API = "https://api.morpho.org";
const PENDLE_API = "https://api-v2.pendle.finance/core";

async function getJson(url, source) {
  return fetchJson(url, source, { headers: { accept: "application/json" } });
}

async function queryMorpho(query) {
  const json = await fetchJson(`${MORPHO_API}/graphql`, "Morpho GraphQL API", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (json.errors?.length) {
    throw new Error(`Morpho GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

let metadataRead;
let metadataExpiry = 0;
async function getSelectedPendleMarket() {
  if (metadataRead && Date.now() < metadataExpiry) return metadataRead;
  metadataExpiry = Date.now() + 60_000;
  metadataRead = fetchSelectedPendleMarket().catch((error) => { metadataRead = null; throw error; });
  return metadataRead;
}

async function fetchSelectedPendleMarket() {
  const endpoint = `${PENDLE_API}/v2/markets/all`;
  const firstPage = await getJson(`${endpoint}?limit=100&skip=0`, "Pendle market metadata API");
  const limit = Number(firstPage.limit);
  const total = Number(firstPage.total);
  if (!(limit > 0 && total > 0)) {
    throw new Error("Pendle market metadata API returned invalid pagination.");
  }
  const pageOffsets = [];
  for (let skip = limit; skip < total; skip += limit) pageOffsets.push(skip);
  const match = (page) => (page.results ?? page.markets ?? []).find((market) =>
    market.chainId === CASE.chainId && market.address?.toLowerCase() === CASE.pendleMarket.toLowerCase());
  if (match(firstPage)) return match(firstPage);
  // Three pages at a time limits bursts against the public API.
  for (let index = 0; index < pageOffsets.length; index += 3) {
    const pages = await Promise.all(pageOffsets.slice(index, index + 3).map((skip) => getJson(`${endpoint}?limit=${limit}&skip=${skip}`, "Pendle market metadata API")));
    for (const page of pages) if (match(page)) return match(page);
  }
  throw new Error("The selected Pendle market was not found in Pendle's public metadata.");
}

async function getPendleExitQuote(collateralAmount, exitFraction) {
  const amount = (BigInt(collateralAmount) * BigInt(Math.round(exitFraction * 10_000))) / 10_000n;
  const request = new URLSearchParams({
    receiver: CASE.publicPosition,
    slippage: "0.01",
    tokensIn: CASE.ptToken,
    tokensOut: CASE.loanToken,
    amountsIn: amount.toString(),
    enableAggregator: "true",
    additionalData: "impliedApy,effectiveApy"
  });
  const url = `${PENDLE_API}/v2/sdk/${CASE.chainId}/convert?${request}`;
  const quote = await getJson(url, "Pendle Hosted SDK convert API");
  const route = quote.routes?.[0];
  const output = route?.outputs?.find((item) => item.token?.toLowerCase() === CASE.loanToken.toLowerCase());
  if (quote.action !== "swap" || !route || !output) {
    throw new Error(`Pendle did not return a direct PT-to-USDC route for the ${(exitFraction * 100).toFixed(0)}% exit quote.`);
  }
  const outputConfig = route.contractParamInfo?.contractCallParams?.[3];
  return {
    fraction: exitFraction,
    request: Object.fromEntries(request),
    action: quote.action,
    input: quote.inputs?.[0],
    output,
    minTokenOut: outputConfig?.minTokenOut ?? null,
    routeData: {
      aggregatorType: route.data?.aggregatorType ?? null,
      priceImpact: route.data?.priceImpact ?? null,
      priceImpactBreakDown: route.data?.priceImpactBreakDown ?? null,
      feeUsd: route.data?.fee?.usd ?? null,
      gasUsed: route.data?.gasUsed ?? null
    }
  };
}

export async function fetchLiveCaseInputs() {
  const positionQuery = `query {
    marketPositions(
      first: 1
      where: {
        marketUniqueKey_in: ["${CASE.marketId}"]
        userAddress_in: ["${CASE.publicPosition}"]
      }
    ) {
      items {
        user { address }
        state { collateral borrowAssets borrowAssetsUsd collateralUsd }
      }
    }
  }`;

  const [positionData, market, marketState, oracle, pendleSwap, underlyingPrice, pendleMarket, oracleInvestigation] = await Promise.all([
    queryMorpho(positionQuery),
    getJson(
      `${MORPHO_API}/v0/blue/markets/${CASE.chainId}:${CASE.marketId}`,
      "Morpho market API"
    ),
    getJson(
      `${MORPHO_API}/v0/blue/markets/${CASE.chainId}:${CASE.marketId}/state`,
      "Morpho market-state API"
    ),
    getJson(
      `${MORPHO_API}/v0/oracles/${CASE.chainId}:${CASE.oracle}/state`,
      "Morpho oracle API"
    ),
    getJson(
      `${PENDLE_API}/v1/sdk/${CASE.chainId}/markets/${CASE.pendleMarket}/swapping-prices`,
      "Pendle swap-price API"
    ),
    getJson(
      `${MORPHO_API}/v0/tokens/${CASE.chainId}:${CASE.underlyingToken}/price`,
      "Morpho underlying-price API"
    ),
    getSelectedPendleMarket(),
    investigateSelectedOracle()
  ]);

  const position = positionData.marketPositions.items[0];
  if (!position) {
    throw new Error("The selected public position is no longer present in the Morpho market.");
  }

  const exitQuotes = await Promise.all([0.25, 0.5, 1].map((fraction) => getPendleExitQuote(position.state.collateral, fraction)));
  return {
    position,
    market: market.data,
    marketState: marketState.data,
    oracle: oracle.data,
    pendleSwap,
    underlyingPrice: underlyingPrice.data,
    pendleMarket,
    exitQuotes,
    oracleInvestigation
  };
}
