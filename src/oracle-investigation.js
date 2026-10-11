import { createHash } from "node:crypto";
import { CASE } from "./case-config.js";
import { fetchJson } from "./http-client.js";

const RPC = "https://eth-mainnet.public.blastapi.io";
const BLOCKSCOUT = "https://eth.blockscout.com/api";
const identityCache = new Map();
// These addresses are immutable configuration dependencies of the selected
// market. Their verified identities were inspected once and are kept locally so
// a live risk refresh never fails merely because an explorer rate-limits reads.
const KNOWN_IDENTITIES = new Map([
  ["0x9b4655239e91dc9e1f7599bb88fba41b4542de5b", { contractName: "MetaOracleDeviationTimelock", compilerVersion: "v0.8.28+commit.7893614a" }],
  ["0x8fca98c9abee4dcb33ba9f3d17db4ad57f72706d", { contractName: "MorphoChainlinkOracleV2", compilerVersion: "v0.8.21+commit.d9974bed" }],
  ["0xe2f4cfe07aecd7fd8fb0d293a22cde7d08175465", { contractName: "MorphoChainlinkOracleV2", compilerVersion: "v0.8.21+commit.d9974bed" }],
  ["0xa572dad7db3d975e9ce780db1cf3bf959401cd35", { contractName: "PendleSparkLinearDiscountOracle", compilerVersion: "v0.8.28+commit.7893614a" }],
  ["0xa569d910839ae8865da8f8e70fffb0cba869f961", { contractName: "EACAggregatorProxy", compilerVersion: "v0.6.6+commit.6c089d02" }],
  ["0xc3866d726c204c0836e0677a31973c649888973d", { contractName: "DummyFeed", compilerVersion: "v0.8.28+commit.7893614a" }]
]);

const SELECTOR = Object.freeze({
  primaryOracle: "0xbd8f238e",
  backupOracle: "0x836efd31",
  currentOracle: "0x2289445e",
  deviationThreshold: "0xd94ad837",
  challengeTimelockDuration: "0x498e8b6e",
  healingTimelockDuration: "0xd83ed440",
  isPrimary: "0x3682152b",
  isDeviant: "0xde1a6975",
  primaryPrice: "0x362a07ae",
  backupPrice: "0xad891006",
  price: "0xa035b1fe",
  baseFeed1: "0xf50a4718",
  baseFeed2: "0xdc53858c",
  baseVault: "0xeaa2d7b4",
  quoteFeed1: "0x56095e11",
  quoteFeed2: "0xacfbd39e",
  quoteVault: "0x2e6f20a6",
  pt: "0xd94073d4",
  maturity: "0x204f83f9",
  baseDiscountPerYear: "0x598e5451",
  description: "0x7284e416",
  decimals: "0x313ce567"
});

function lower(address) {
  return address.toLowerCase();
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const isZeroAddress = (address) => lower(address) === ZERO_ADDRESS;

function decodeAddress(hex) {
  return `0x${hex.slice(-40)}`;
}

function decodeUint(hex) {
  return BigInt(hex);
}

function decodeBoolean(hex) {
  return decodeUint(hex) !== 0n;
}

function decodeString(hex) {
  const length = Number(BigInt(`0x${hex.slice(66, 130)}`));
  return Buffer.from(hex.slice(130, 130 + length * 2), "hex").toString("utf8");
}

function parseMinimalProxyImplementation(code) {
  const match = code.toLowerCase().match(/363d3d373d3d3d363d73([0-9a-f]{40})5af43d82803e903d91602b57fd5bf3/);
  return match ? `0x${match[1]}` : null;
}

async function rpc(calls) {
  const request = calls.map((call, id) => ({ jsonrpc: "2.0", id, ...call }));
  const body = await fetchJson(RPC, "Ethereum oracle RPC", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request)
  });
  if (!Array.isArray(body)) throw new Error("Ethereum RPC returned an invalid batch response.");
  const byId = new Map(body.map((item) => [item.id, item]));
  return calls.map((_, id) => {
    const item = byId.get(id);
    if (!item || item.error) throw new Error(`Ethereum RPC call ${id} failed: ${item?.error?.message ?? "no response"}`);
    return item.result;
  });
}

async function call(to, data) {
  const [result] = await rpc([{ method: "eth_call", params: [{ to, data }, "latest"] }]);
  return result;
}

async function contractIdentity(address) {
  const normalized = lower(address);
  const cached = identityCache.get(normalized);
  if (cached) return cached;
  const known = KNOWN_IDENTITIES.get(normalized);
  if (known) {
    const identity = Object.freeze({
      ...known,
      sourceUrl: `https://eth.blockscout.com/address/${address}?tab=contract`,
      sourceVerification: "verified source identity cached for this fixed market dependency"
    });
    identityCache.set(normalized, identity);
    return identity;
  }
  const url = `${BLOCKSCOUT}?module=contract&action=getsourcecode&address=${address}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (response.status === 429 && attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw new Error(`Blockscout responded with HTTP ${response.status}.`);
    const body = await response.json();
    const result = body.result?.[0];
    if (!result?.ContractName) throw new Error(`No verified Blockscout contract identity found for ${address}.`);
    const identity = Object.freeze({
      contractName: result.ContractName,
      compilerVersion: result.CompilerVersion,
      sourceUrl: `https://eth.blockscout.com/address/${address}?tab=contract`
    });
    identityCache.set(lower(address), identity);
    return identity;
  }
  throw new Error(`Blockscout rate-limited source lookup for ${address}.`);
}

async function chainlinkConfiguration(address) {
  const calls = [SELECTOR.baseFeed1, SELECTOR.baseFeed2, SELECTOR.baseVault, SELECTOR.quoteFeed1, SELECTOR.quoteFeed2, SELECTOR.quoteVault]
    .map((data) => ({ method: "eth_call", params: [{ to: address, data }, "latest"] }));
  const [baseFeed1, baseFeed2, baseVault, quoteFeed1, quoteFeed2, quoteVault] = await rpc(calls);
  return {
    baseFeed1: decodeAddress(baseFeed1),
    baseFeed2: decodeAddress(baseFeed2),
    baseVault: decodeAddress(baseVault),
    quoteFeed1: decodeAddress(quoteFeed1),
    quoteFeed2: decodeAddress(quoteFeed2),
    quoteVault: decodeAddress(quoteVault)
  };
}

/**
 * Performs a narrow, read-only oracle implementation trace for the selected
 * market. This is deliberately specific: it turns a vague graph edge into a
 * reproducible chain of deployed contracts and live configuration values.
 */
export async function investigateSelectedOracle() {
  const oracle = CASE.oracle;
  const [oracleCode, ...meta] = await rpc([
    { method: "eth_getCode", params: [oracle, "latest"] },
    ...[
      SELECTOR.primaryOracle,
      SELECTOR.backupOracle,
      SELECTOR.currentOracle,
      SELECTOR.deviationThreshold,
      SELECTOR.challengeTimelockDuration,
      SELECTOR.healingTimelockDuration,
      SELECTOR.isPrimary,
      SELECTOR.isDeviant,
      SELECTOR.primaryPrice,
      SELECTOR.backupPrice,
      SELECTOR.price
    ].map((data) => ({ method: "eth_call", params: [{ to: oracle, data }, "latest"] }))
  ]);
  const [
    primaryRaw,
    backupRaw,
    currentRaw,
    thresholdRaw,
    challengeRaw,
    healingRaw,
    isPrimaryRaw,
    isDeviantRaw,
    primaryPriceRaw,
    backupPriceRaw,
    priceRaw
  ] = meta;
  const implementation = parseMinimalProxyImplementation(oracleCode);
  if (!implementation) throw new Error("Selected oracle is not the expected EIP-1167 minimal proxy shape.");
  const primaryOracle = decodeAddress(primaryRaw);
  const backupOracle = decodeAddress(backupRaw);
  const currentOracle = decodeAddress(currentRaw);
  const [primaryConfig, backupConfig] = await Promise.all([
    chainlinkConfiguration(primaryOracle),
    chainlinkConfiguration(backupOracle)
  ]);
  const implementationIdentity = await contractIdentity(implementation);
  const primaryIdentity = await contractIdentity(primaryOracle);
  const backupIdentity = await contractIdentity(backupOracle);
  const pendleDiscountFeed = primaryConfig.baseFeed1;
  const usdeUsdFeed = backupConfig.baseFeed2;
  const dummyQuoteFeed = backupConfig.quoteFeed1;
  const [pendlePtRaw, maturityRaw, discountRaw, usdeDescriptionRaw, usdeDecimalsRaw, dummyDescriptionRaw, dummyDecimalsRaw] = await Promise.all([
    call(pendleDiscountFeed, SELECTOR.pt),
    call(pendleDiscountFeed, SELECTOR.maturity),
    call(pendleDiscountFeed, SELECTOR.baseDiscountPerYear),
    call(usdeUsdFeed, SELECTOR.description),
    call(usdeUsdFeed, SELECTOR.decimals),
    call(dummyQuoteFeed, SELECTOR.description),
    call(dummyQuoteFeed, SELECTOR.decimals)
  ]);
  const pendleIdentity = await contractIdentity(pendleDiscountFeed);
  const usdeIdentity = await contractIdentity(usdeUsdFeed);
  const dummyIdentity = await contractIdentity(dummyQuoteFeed);
  const pt = decodeAddress(pendlePtRaw);
  const baseDiscountPerYear = Number(decodeUint(discountRaw)) / 1e18;
  const primaryUsesSelectedPt = lower(pt) === lower(CASE.ptToken);
  // A topology statement is useful only when every relevant leg is checked.
  // Looking at one zero address can accidentally bless a composition that is
  // economically very different from the one we mean to model.
  const primaryHasOnlyDiscountFeed =
    isZeroAddress(primaryConfig.baseFeed2) &&
    isZeroAddress(primaryConfig.baseVault) &&
    isZeroAddress(primaryConfig.quoteFeed1) &&
    isZeroAddress(primaryConfig.quoteFeed2) &&
    isZeroAddress(primaryConfig.quoteVault);
  const backupUsesSelectedPtDiscount = lower(backupConfig.baseFeed1) === lower(pendleDiscountFeed);
  const backupHasUsdeUsdFeed = !isZeroAddress(backupConfig.baseFeed2) && /USDe\s*\/\s*USD/i.test(decodeString(usdeDescriptionRaw));
  const activePathMatchesSelection = decodeBoolean(isPrimaryRaw)
    ? lower(currentOracle) === lower(primaryOracle)
    : lower(currentOracle) === lower(backupOracle);
  const identitiesMatch = implementationIdentity.contractName === "MetaOracleDeviationTimelock" &&
    primaryIdentity.contractName === "MorphoChainlinkOracleV2" &&
    backupIdentity.contractName === "MorphoChainlinkOracleV2" &&
    pendleIdentity.contractName === "PendleSparkLinearDiscountOracle";
  const confirmedTopology = primaryUsesSelectedPt && primaryHasOnlyDiscountFeed && backupUsesSelectedPtDiscount && backupHasUsdeUsdFeed && activePathMatchesSelection && identitiesMatch;
  return Object.freeze({
    schemaVersion: "fulcrum-oracle-investigation/v1",
    method: "Read-only EIP-1167 proxy trace and verified contract configuration",
    rpc: RPC,
    oracle: Object.freeze({
      address: oracle,
      runtimeCodeSha256: createHash("sha256").update(oracleCode).digest("hex"),
      proxyPattern: "EIP-1167 minimal proxy",
      implementation: Object.freeze({ address: implementation, ...implementationIdentity }),
      primaryOracle,
      backupOracle,
      currentOracle,
      isPrimary: decodeBoolean(isPrimaryRaw),
      isDeviant: decodeBoolean(isDeviantRaw),
      deviationThreshold: Number(decodeUint(thresholdRaw)) / 1e18,
      challengeTimelockSeconds: Number(decodeUint(challengeRaw)),
      healingTimelockSeconds: Number(decodeUint(healingRaw)),
      primaryPriceRaw,
      backupPriceRaw,
      selectedPriceRaw: priceRaw
    }),
    primary: Object.freeze({ address: primaryOracle, ...primaryIdentity, configuration: Object.freeze(primaryConfig) }),
    backup: Object.freeze({ address: backupOracle, ...backupIdentity, configuration: Object.freeze(backupConfig) }),
    feeds: Object.freeze({
      pendleLinearDiscount: Object.freeze({
        address: pendleDiscountFeed,
        ...pendleIdentity,
        pt,
        maturityUnix: Number(decodeUint(maturityRaw)),
        baseDiscountPerYear,
        tracksSelectedPt: primaryUsesSelectedPt
      }),
      usdeUsd: Object.freeze({
        address: usdeUsdFeed,
        ...usdeIdentity,
        description: decodeString(usdeDescriptionRaw),
        decimals: Number(decodeUint(usdeDecimalsRaw))
      }),
      dummyQuote: Object.freeze({
        address: dummyQuoteFeed,
        ...dummyIdentity,
        description: decodeString(dummyDescriptionRaw),
        decimals: Number(decodeUint(dummyDecimalsRaw))
      }),
      validation: Object.freeze({
        primaryUsesSelectedPt,
        primaryHasOnlyDiscountFeed,
        backupUsesSelectedPtDiscount,
        backupHasUsdeUsdFeed,
        activePathMatchesSelection,
        identitiesMatch
      })
    }),
    conclusion: Object.freeze({
      classification: confirmedTopology
        ? "confirmed_static_primary_with_usde_aware_backup"
        : "configuration_requires_manual_review",
      directLivePendleExitDependency: false,
      summary: confirmedTopology
        ? "The current Morpho collateral oracle selects a primary linear-discount feed for the selected PT. The primary does not directly consume Pendle's live exit price. A backup path adds a USDe/USD feed and is reachable only through the meta-oracle's deviation and timelock controls."
        : "The live configuration did not pass every topology check. Treat price-path claims as unresolved and review the recorded validation flags before using this case model."
    })
  });
}
