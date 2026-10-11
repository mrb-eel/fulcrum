# Import a portfolio

Import runs locally in the browser. It does not upload the file to a provider.
Maximum: 5 MB and 1,000 positions. Exported portfolios can be re-imported.
Every non-example imported record is labelled "imported", even if it says "observed".
Supplied evidence is not independently verified by importing it.

The root object has `schemaVersion: "fulcrum-portfolio/v1"` and a `positions` array.
Every position has a unique ID. Unsupported or invalid position records remain
visible and are excluded from totals. Duplicate IDs reject the whole import.

## Position fields

- id, label: nonempty strings.
- kind: `collateralized-loan`, `spot`, `supply`, or a distinct unsupported type.
- protocol, chainId, owner, marketId: descriptive optional metadata.
- observedAt: ISO timestamp of the supplied observation.
- origin: `imported`, or `illustrative` for examples excluded from totals.
- assets: up to 128 independently identified asset legs.
- oracle: mode `fixed`, `market`, `unknown`, or `none`; evidenceIds list.
- evidence: records with id, claim, status (`observed`, `derived`, `assumed`), sourceUrl.
- dependencies: id, label, lens (`value`, `control`, `liquidation`, `exit`),
  status (`observed`, `inferred`, `unresolved`), assetIds, evidenceIds.
- quotes: fraction (0 < fraction <= 1), proceedsUsd, observedAt, sourceUrl.

Each asset needs id, symbol, role (`collateral`, `holding`, `debt`), and valueUsd.
Set valueUsd to null when unknown, not zero. Amounts are already converted to USD.
Use chain + token address as stable IDs to match dependencies across positions.
For liquidation calculations, each collateral leg needs oracleValueUsd and
liquidationThreshold as a fraction. These must be on the same USD basis as debt.

Fixed means unaffected by the instantaneous market shocks. Market means the
model applies both selected underlying and exit shocks to the oracle value.
Neither mode is inferred from a token symbol. Declaring either requires a
supporting evidence or assumption record. Unknown mode withholds a precise
shocked health factor. Its fixed/market comparison is not a guaranteed bound.

oracle.denomination is `usd` by default, or `loan` for a price quoted in the
loan currency. A fixed loan-denominated oracle preserves native health when
the loan currency's USD price changes; the USD value of both sides reprices.
Economic equity can still fall as the USD debt grows. A market-following mode
instead follows the shocked USD asset value. Choose the unit explicitly.

An optional oracle.backup object can supply challengeHours and description.
The UI can explore assumed activation and a separate oracle-price haircut.
It does not simulate the contract transition or infer automatic switching.

## Important accounting rules

Represent assets once. Do not include both a vault share and its look-through
assets as independent portfolio value; put backing assets in dependency records.
Positions that share margin or collateral must be consolidated into a single
loan record before applying this model. LPs, options, perps and recursive shares
need dedicated payoff adapters; labelling them as spot does not model their risk.

Each quote covers a proportional fraction of the position's non-debt assets.
Mixed collateral quotes must cover that entire basket. A quote for one asset
must not be presented as a quote for the basket. Quote sizes are matched exactly;
the engine never scales a small quote to estimate a larger sale.

## Example (assumed balances, not an observed position)

```json
{
  "schemaVersion": "fulcrum-portfolio/v1",
  "label": "My supplied portfolio",
  "positions": [{
    "id": "my-loan",
    "label": "ETH / USDC loan",
    "kind": "collateralized-loan",
    "origin": "imported",
    "observedAt": "2026-10-10T12:00:00Z",
    "assets": [
      {"id":"1:eth","symbol":"ETH","role":"collateral","valueUsd":100000,"oracleValueUsd":100000,"liquidationThreshold":0.8},
      {"id":"1:usdc","symbol":"USDC","role":"debt","valueUsd":60000}
    ],
    "oracle":{"mode":"unknown","evidenceIds":[]},
    "evidence":[{"id":"inputs","status":"assumed","claim":"User-supplied balances.","sourceUrl":null}],
    "dependencies":[{"id":"token:1:eth","label":"ETH price","lens":"value","status":"inferred","assetIds":["1:eth"],"evidenceIds":["inputs"]}],
    "quotes":[]
  }]
}
```

No source URL is invented in this example. An observed record or quote needs
its actual HTTP(S) source URL. New API adapters should produce this same schema
and preserve unsupported rows, provenance, timestamps and scope completeness.
