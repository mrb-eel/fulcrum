# Selected case - leveraged PT-sUSDe position on Ethereum

## Decision

FULCRUM will analyse the public Ethereum position at
`0xdf81987465681D0515058fe0A47A3bD174012730` in Morpho's
**USDC / PT-sUSDE-26NOV2026** market.

This is an evidence-backed real on-chain position, not a synthetic portfolio.
The address is public but unattributed. We make no claim that it belongs to
Belem Capital or that its owner intends the strategy we infer from its state.

The position deposits Pendle principal tokens as collateral and borrows USDC.
It is the strongest case because a single position gives us all five layers in
the challenge brief:

1. **Settlement:** Ethereum.
2. **Yield source:** Ethena sUSDe, a yield-bearing synthetic dollar.
3. **Oracle:** a Morpho oracle values PT-sUSDE in USDC.
4. **Exit market:** the Pendle PT-sUSDe market and its AMM/limit-order route.
5. **Lending:** Morpho accepts the PT as collateral for a USDC loan.

## Why it is relevant to Belem Capital

Belem describes its institutional strategies as using liquidity provision,
lending and borrowing, and arbitrage, with a USD strategy and a stated focus
on market-neutral returns. This case is a USD-denominated, on-chain yield and
collateral structure using those same building blocks.

It is **not** evidence that Belem holds Ethena, Pendle, Morpho, or this public
address. It is a relevant stress-testing case for the type of dependency chain
the challenge describes.

## Observed facts at selection time (10 October 2026)

| Item | Observed value | Source |
| --- | ---: | --- |
| Pendle market | `0x47ad...f77e`, expires 26 November 2026 | Pendle Core API |
| PT collateral token | `0xB195...9390` | Pendle and Morpho APIs |
| Pendle-reported market liquidity | $3.82m | Pendle Core API |
| Morpho market | `0x5613...cb05` | Morpho API |
| Morpho collateral rule (LLTV) | 91.5% | Morpho API |
| Morpho available USDC liquidity | about $764.5k | Morpho API |
| Public position collateral | 3,961,491.35 PT | Morpho GraphQL API |
| Public position collateral value | $3.934m | Morpho GraphQL API |
| Public position USDC debt | $3.414m | Morpho GraphQL API |
| Current LTV | 86.78% | calculated from observed values |
| Approx. oracle-price fall to liquidation | 5.16% | calculated from observed values and 91.5% LLTV |

The liquidation distance is calculated as:

    1 - debt / (collateral_value * LLTV)

It is a mechanical threshold calculation. It does not predict that liquidation
will occur.

## What makes the case especially good for the demo

### It has a real, non-trivial decision

The position sits roughly 5.16% above its liquidation threshold. A modest
decline in the oracle-valued PT price can matter immediately. The system can
therefore demonstrate a real choice between waiting, reducing debt/exposure,
or exiting part of the PT position.

### The exit route is observable

Pendle's public quote endpoint returned a live PT-to-sUSDe swap rate and a
route quote for the full observed PT collateral. That route reported about
0.297% internal price impact and about $489 in Pendle fee at the time queried.
This is a quote for the PT-to-sUSDe leg only; it is not yet the complete cost
of receiving USDC, and it does not include transaction gas. The application
will calculate and label the complete supported exit route rather than treating
this preliminary figure as a final result.

### It exposes the main innovation naturally

FULCRUM can test this question:

> Does the lending oracle reflect the same PT discount that an investor faces
> when trying to exit through Pendle?

At selection time, the live Morpho oracle was about 0.99236 USDC per PT. The
Pendle swap rate multiplied by the reported sUSDe conversion rate was about
0.99367 USDe per PT, a 0.132% difference. This is strong consistency evidence,
but it is **not proof of the oracle's construction**. Morpho's public API
labels the oracle type `Unknown` and does not disclose its composition.

That becomes our active investigation: retrieve contract/deployment evidence,
then classify the relationship as confirmed, rejected, or unresolved. Until
then, the graph will show it as an inference with an explicit limitation.

## Candidate comparison

| Candidate | Why it was considered | Decision |
| --- | --- | --- |
| PT-sUSDe, Ethereum, 26 Nov 2026 | Stablecoin yield; Pendle and Morpho layers are live; meaningful public leveraged position; observable oracle and exit quote. | **Selected** |
| PT-wstETH, Ethereum, 30 Dec 2027 | Directly relevant to ETH-denominated mandates and has liquid Pendle trading. | Good fallback, but it does not currently provide as clear a verified lending-cascade demonstration. |
| PT-USDai, Arbitrum, 15 Oct 2026 | Very deep reported liquidity. | Rejected: maturity is only days away and the protocol adds complexity without improving the core demonstration. |

## Known limitations and safeguards

- All figures are time-sensitive. Step 4 will capture a timestamped local
  snapshot and the interface will show its retrieval time.
- The selection-time quote cannot prove executable size after market conditions
  change. Quotes must be refreshed for each run.
- Ethena's model includes risks that differ from fiat-backed stablecoins. The
  demo must state that sUSDe is a synthetic dollar and must not call it USDC.
- No probability of depeg, oracle error, or protocol failure will be invented.
  We will show conditional losses and break-even probabilities instead.
- The public address is a case study only. The product will display it in
  shortened form by default.

## Sources to use in the application

- Pendle Core API: market metadata, live market state, and exit quotes.
- Morpho public REST and GraphQL APIs: market configuration, oracle state, and
  public position state.
- Ethena documentation: definition and mechanics of USDe/sUSDe.
- Official protocol documentation for any formula used in the implementation.
