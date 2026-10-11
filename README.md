# FULCRUM

Fulcrum finds the dependencies under a DeFi position, prices what an incident would cost the holder, and returns a stay-or-exit verdict with the reasoning attached. Built solo for the Belem Capital DeFi Risk Dependency Challenge at the Blockchain Student Association hackathon.

## Run it

```bash
node --test
node src/server.js
```

Open `http://localhost:4173`. The app evaluates offline from saved, fingerprinted evidence. To capture fresh data (needs internet):

```bash
node scripts/capture-book.js
```

## Screens

| Page | Path | Use |
| --- | --- | --- |
| Start | `/` | 3D cutaway of one real position, stepped layer by layer, ending in a live depeg verdict. A numbered tour bar on every page leads through the rest. |
| Method | `/how.html` | The presentation. Arrow keys move between slides; every number is live. |
| Book | `/book.html` | Ten real Morpho vaults as ten 10% pockets. One incident hits all of them; each pocket gets a verdict; shared dependencies are listed with their share of the book. |
| X-ray viewer | `/xray.html` | One vault as a clickable grid with one-click scenarios. Paste any Morpho V1 vault address to capture and X-ray it live, or drop a saved vault JSON packet onto the page. |
| Vault details | `/vault.html?id=…` | One vault layer by layer: market, collateral, issuer, oracle, chain. Oracle sight map, loss split, limit breach, every borrower. |
| PT case | `/case.html` | The brief's own example: a leveraged PT-sUSDe loan on Morpho with its oracle traced on-chain and quoted exit costs. |
| Workspace | `/portfolio.html` | Import positions, scan a wallet (Morpho Blue), stress and rehearse exits. |

Keys on Book and X-ray: `T` switches to plain tables, `F` opens 3 a.m. mode (full-screen verdict), `Esc` closes it.

## Pipeline

1. Capture: `src/vault-discovery.js` reads each vault, its markets and every borrower from the Morpho indexer until borrower shares reconcile. `src/enrichment.js` reads every oracle contract and feed `description()` directly from Ethereum at one pinned block, plus daily BTC/USD and ETH/USD closes from Bitstamp. Each packet is SHA-256 fingerprinted.
2. Dependencies: `src/vault-engine.js` builds the graph: market, collateral token, issuer or custodian (`src/registry.js`, curated with sources), oracle inputs, conversion vaults, chain, protocol and controllers. Each oracle is classified by what it can see: a market feed for the token's peg, only an issuer rate, nothing related, or unverified.
3. Impact: For each borrower, shortfall = max(0, debt − collateral × (1 − shock) × (1 − sale discount)). On the gradual path liquidations fire at the boundary when the oracle follows and LIF × (1 − discount) ≥ 1, with LIF = 1 / (0.3·LLTV + 0.7). When the oracle cannot see a depeg, new borrowers can post the mispriced token and borrow the market's cash. Losses pass through the vault's supply share and then the holder's share, and are split into existing shortfall, incident loss and unrelated unknowns.
4. Decision: Exit cost = net APY over the horizon on the withdrawable amount + gas. The probability is the historical share of windows with a move of that size (`src/base-rates.js`) or the user's own figure. Verdicts: STAY, EXIT, REVIEW, or STAY UNLESS with the break-even probability.
5. Book: `src/book-engine.js` applies one incident to all ten pockets and matches shared dependencies by token and feed address.
6. Other protocols: `src/lending-scan.js` reads every Aave v3 and Spark reserve's oracle source and its `description()` at one block and applies the same depeg-visibility classification (`node scripts/capture-lending.js`). Borrower-level loss stays Morpho-only.

## Findings in the saved capture

- Steakhouse USDC holds 43% in a cbBTC market whose oracle reads only `BTC / USD`. A cbBTC depeg would not trigger liquidations there. The WBTC market reads `WBTC / BTC` and would.
- Several large markets price staked ETH, weETH, sUSDe, reUSD and tokenised funds with issuer exchange rates, so a market discount on those tokens is invisible to the lending oracle.
- A 35% BTC fall costs a $1M Steakhouse USDC deposit about $5.1k if it gaps and nothing if it is gradual and liquidators can sell within the 4.2% break-even.

## API

| Endpoint | Returns |
| --- | --- |
| `GET /api/book`, `POST /api/book/evaluate` | Pockets, shared dependencies, per-pocket verdicts |
| `GET /api/vault?id=`, `POST /api/vault/evaluate` | Model, scenario result, decision, reverse stress, shock curve |
| `POST /api/vault/capture` `{address}`, `POST /api/vault/import` (packet) | Add any Morpho V1 vault, live or from a saved packet |
| `GET /api/vault/evidence?id=`, `/api/vault/graph?id=` | Raw packet, full dependency graph |
| `GET /api/lending` | Aave v3 and Spark oracle scan |
| `GET /api/book/enrichment`, `/api/book/history` | On-chain oracle reads, price history |
| `/api/demo-analysis`, `/api/evaluate`, `/api/discover` | PT case and workspace (unchanged) |

## Limits

Borrower-level loss for Morpho V1 vaults with direct markets; Aave v3 and Spark get the oracle scan only. Liquidation capacity from DEX depth and cash reallocated into a drained market are not modelled. Frequencies are history, not forecasts. Pocket weights are hypothetical and no holding is attributed to Belem.
