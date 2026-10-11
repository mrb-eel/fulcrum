# FULCRUM backend system

## New main case: vault look-through

The vault case uses `vault-discovery.js` and `vault-engine.js`; the PT architecture
below remains a separate comparison. The main page is `public/vault.html`.

The collector reads a V1-family vault from Morpho GraphQL, then paginates borrowers
in every funded direct market. Three scans run at a time, at most 64 markets and
30 pages per market, 200 borrowers per page, with a 90-second scan budget. Each provider request has a timeout
and bounded retries. The original requests and responses are saved, with collection
times, observation blocks and a canonical SHA-256 fingerprint. A fingerprint detects
file changes; it is not signed provenance. Page limits, failures and missing marks
remain explicit. The collector does not call unknown URLs from provider metadata.

Market identity is chain plus market ID; feed, collateral and borrower identities
are chain plus address. Shared dependencies count each market allocation once.
Shared-borrower exposure instead counts the vault's fraction of that borrower's
debt, not the whole market. Known feed inputs come from oracle union types in the
indexer. A missing composition stays unknown. An oracle conversion-vault address
is recorded but its own investments are not recursively expanded.

For market j, let S_j be total supply and A_j the vault's supply. For borrower i,
let D_ij be debt and C_ij the independent reference collateral mark in USDC.
Debt is recomputed from borrower shares at the captured market state with Morpho's
virtual assets (1) and shares (1e6), rounding upward in integer base units. Unknown
or mismatched borrower coverage widens the range; an over-count rejects the packet.

With collateral decline x and recovery discount c:

    borrower shortfall = max(0, D_ij - C_ij * (1-x) * (1-c))
    vault loss in market j = (A_j / S_j) * sum(borrower shortfalls)
    depositor economic loss = (depositor assets / vault total assets) * sum(vault losses)

The sum is over individual positive shortfalls. Netting surplus collateral between
different borrowers would understate risk. The estimate is eventual recovery after
a declared haircut, not the outcome of simulated Morpho liquidations. Incentives,
top-ups, execution curves and timing are not dynamically modelled. Lending health
uses the native oracle value and LLTV separately, with declared following/frozen
oracle counterfactuals. USD marks never replace the native health price.

For missing C_ij, shortfall is bounded from zero to D_ij. Missing debt coverage gets
the same treatment. The lower/upper sums are information bounds within this model,
not statistical confidence intervals. Reverse stress solves each endpoint by bounded
bisection; a zero upper-end boundary caused by unknown values is reported explicitly.

For each market in the withdrawal queue, available cash is min(A_j, S_j-D_j).
Off-queue allocations contribute zero. The sum is capped by reported vault liquidity,
then reduced by assumed earlier withdrawals and capped at the user's holding.
A withdrawal-freeze scenario removes selected markets' cash contribution without
inventing an economic haircut. A feed outage does not automatically imply a freeze.
No future liquidation proceeds are counted as immediately available cash.

The cost comparison requires a supplied event probability and total cost for the
available withdrawal. It compares that cost with the probability-weighted proportional
loss avoided. This assumes withdrawal before loss recognition, with proportional
exposure removed. It is not a forecast or a transaction recommendation. Vault-version
loss recognition, permissions, gas, transaction order and execution are not proved.

Tests cover independent borrower losses, two stages of lender/depositor attribution,
shared-feed de-duplication, missing valuations, incomplete pagination, off-queue cash,
competing exits, oracle-health separation, reverse thresholds, malformed data,
fingerprint tampering, real capture reconciliation and HTTP integration.

## PT comparison system

FULCRUM is designed to answer a narrow, defensible question:

> Given this exact public DeFi position at this exact time, which small,
> explicit changes would cause a material loss, and what information would
> change the decision to reduce it?

It is not a generic risk score. Each output points back to a saved input or a
labelled assumption.

## 1. Evidence snapshot: the black box recorder

`src/live-evidence-snapshot.js` reads the selected public Morpho and Pendle
data once, gives every observed claim its source and time, then creates a
canonical SHA-256 fingerprint.

The fingerprinted snapshot contains:

- the raw API responses; and
- a nine-item source-bound evidence ledger.

The graph and oracle-vs-exit tomography are derived views. On load, FULCRUM
recreates them from the fingerprinted snapshot instead of trusting editable
top-level JSON fields beside it.

An edge cannot enter the graph unless it names evidence that exists in the
ledger. An observed claim cannot enter the ledger without a source. This is
how the system avoids an attractive but unverifiable dependency map.

## 2. Dependency tomography: a financial X-ray

The system compares three independently obtained live values:

1. Morpho's PT collateral oracle;
2. Pendle's PT-to-sUSDe conversion; and
3. sUSDe's USD reference price.

This began as a price-consistency test. FULCRUM then traces the on-chain
deployment path and accepts a topology conclusion only after it confirms the
active path, every primary feed/vault leg, the selected PT, the backup's
USDe/USD feed description, and the expected contract identities. If any one
check differs, the route is marked for manual review instead of inferred from
price proximity. See [ORACLE_INVESTIGATION.md](ORACLE_INVESTIGATION.md).

## 3. Causal propagation: three distinct rays

`src/risk-engine.js` sends a declared scenario through three separate paths:

| Ray | Input | Financial result |
| --- | --- | --- |
| Value | sUSDe USD haircut | lowers the underlying value of each PT |
| Escape | extra PT exit discount | lowers the PT-to-sUSDe conversion available to an exit |
| Lending valuation | traced oracle state | changes the Morpho collateral value and liquidation health |

The first two paths multiply. This is deliberate: the system never adds the
same collateral loss twice. The default lending path follows the observed
current primary, which does not inherit live exit-liquidity shocks. A clearly
labelled backup-after-timelock scenario can model the USDe/USD-aware path.

For a position with PT quantity `Q`, debt `D`, PT conversion `r`, and
underlying USD price `p`, the modelled collateral reference value is:

```
V_exit = Q × r × p × (1 - underlying_haircut) × (1 - exit_discount)
```

Position reference equity is `V_exit - D`. This value is not a size-specific
execution quote. Morpho health is calculated separately in loan-token units:
`Q × oracle_price_USDC × LLTV / debt_USDC`. API USD collateral marks do not
substitute for the deployed oracle. The model reports
liquidation as a trigger, but does not invent a liquidation fee, auction loss,
or gas cost.

## 4. Critical-path search: reverse stress without fake probabilities

`findCriticalShock` searches a stated 12 × 12 grid of value and exit shocks.
It returns the lowest sum of the two shocks that crosses the selected equity
loss limit. The standard default is a 10% position-equity loss.

That answer means *least severe case inside this grid*. It does not mean the
event is likely or that the grid contains every possible failure mode.

The interface also solves the exact one-dimensional threshold for the chosen
underlying haircut: `exit_discount = 1 - (1 - loss_limit × equity / value) /
(1 - underlying_haircut)`, floored at zero when the underlying shock alone
crosses the limit. This uses the same model as the curve.

## 5. Decision frontier: cost versus conditional loss

`src/decision-engine.js` compares hold, partial reduction, and exit using
three read-only Pendle Hosted SDK PT-to-USDC quotes: 25%, 50%, and 100% of the
observed collateral. Before accepting a quote it checks both token identities,
the exact native PT amount, expected USDC amount and recorded minimum USDC
amount against the position and market. It records quote output, route price
impact, protocol fee, and gas units. The USD gas cost is deliberately excluded
because the quote does not provide a gas price. For a reduction fraction `f`,
conditional loss `L`, and execution cost `C`:

```
avoided conditional loss = f × L
break-even event probability = C / (f × L)
```

If no defensible probability exists, FULCRUM reports the break-even threshold
and deliberately gives no unconditional recommendation. It also refuses an
exit option that lacks cost provenance.

Quote outputs are in USDC; the comparison converts them to USD using the same
rate implied by the position's debt balances. Cost is derived as reference
value less expected quote proceeds, while the minimum received remains visible
as a separate execution bound. It is not simply the provider's fee field.
The comparison assumes a feasible proportional reduction before the shock.
Gas, funding, debt unwind and foregone carry are excluded. A PT swap route alone
does not prove an executable withdrawal of pledged collateral.

## Reproducibility

Run `npm run capture:snapshot` to create an immutable local case file. The
risk engine can analyse that file later without reading new market data. The
current system has 41 automated tests covering evidence integrity, graph
integrity, oracle-path separation, accounting, reverse stress, route-quote
provenance, and decision thresholds.

## Interface and refresh reliability

The browser and API import the same pure calculation modules. A slider change
recomputes against the exact loaded packet without making a network request.
A failed refresh leaves that packet and its controls in place. A successful
capture replaces all inputs together. The server recomputes the saved snapshot
fingerprint and selects by observation time, rather than filesystem mtime.
Public API reads have timeouts, bounded retries and named provider errors.
Concurrent refreshes share one collection. Market metadata is cached for 60
seconds and paginated in small batches.

The current environment blocks outbound network access. The saved case works;
a successful fresh capture remains to be checked after server network access
is restored. No old values are labelled as a successful new capture.

## Visual direction

The redesigned interface uses an inspection layout for laptop viewing: warm
paper, a dark dependency diagram, and muted orange for modelled losses. The
graph and chart carry the explanation; copy stays short and concrete. It keeps
the selected public case and 10% loss default. Controls expose contract detail,
scenario assumptions and quote limitations instead of adding display-only
features. The previous interface is saved in `archive/ui-v1`.
