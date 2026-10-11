# Fulcrum: pitch, demo and Q&A

Blockchain Student Association hackathon, Belem Capital DeFi Risk Dependency Challenge. Solo entry.

## Before you go on

- Start the server: `node src/server.js`, then open `http://localhost:4173`.
- Browser full screen (F11), zoom at 100%, every other tab closed.
- Wi-Fi on: the 3D view and fonts load from the internet. Everything else runs from saved data.
- Open the X-ray viewer once beforehand so the page is cached.
- Have the backup video ready on the desktop in case the laptop or Wi-Fi fails.

## The 30-second version (if someone asks "so what is it?")

"Fulcrum takes a DeFi position and opens it up: which markets it lends into, which collateral backs those loans, who issues that collateral, and which oracle prices it. Then it breaks one of those layers and tells you, in dollars, whether you should exit. The main thing it found is that a lot of lending oracles can't see the depegs that would hurt lenders. cbBTC is priced as if it were BTC on Morpho, Aave and Spark."

## The 3-minute demo

### 0:00 to 1:10, Start page (scroll)

Open `/`. Scroll one step at a time.

1. **Intro.** "Belem asked: you hold a book of positions, one gets hit, do you pay to get out? This is one real position: $1M in Steakhouse USDC, a $65M Morpho vault. To the holder it's one line, USDC earning 4.3%."
2. **Markets.** "Underneath, it lends into 11 markets, about 1,600 borrower positions. cbBTC alone is 43% of the vault."
3. **Collateral, issuer.** "Each token only holds its value if someone backs it. Coinbase holds the BTC behind cbBTC, BitGo behind WBTC."
4. **Oracle.** Pause here. "This is the part that matters. Liquidations only happen when the market's oracle sees the collateral drop. I read every oracle contract on-chain. WBTC's oracle reads WBTC/BTC, so it would see a depeg. cbBTC's oracle reads BTC/USD only. If cbBTC depegs, the market doesn't notice. 78% of this vault sits behind oracles that can't see a depeg."
5. **Shock 1.** "BTC drops 35% over a few days: $0 loss, liquidators clear the risky loans in time."
6. **Shock 2.** "Same size, but cbBTC depegs, right now. Nobody gets liquidated, and people can post cheap cbBTC and borrow the market's cash. Loss: about $12,400, exit cost: $3,500. Verdict: exit."
7. **Comparison.** Stop for 3 seconds. "This is how it differs from a usual risk dashboard: dollars instead of scores, oracles read from the contracts instead of labels."

### 1:10 to 2:20, Book

Click **Next** twice to reach **Book** (step 3).

- Set Shock type **Depeg**, Target **cbBTC**, Scenario **In progress**.
- "The same shock across ten real Morpho vaults. Eight hold cbBTC. Four should exit: Steakhouse USDC, Gauntlet USDC Prime, Spark Blue Chip and Gauntlet USDC RWA. The book loses about $67,000."
- Scroll to the table of shared dependencies. "Ten vaults look diversified, but the BTC/USD feed sits under 32% of the book and cbBTC under 26%."
- Scroll to **Same check on Aave v3 and Spark**. "And it's not just Morpho. Aave prices cbBTC with BTC/USD, and USDe with the USDT/USD feed. 42% of Aave's collateral sits behind oracles that can't see a depeg."

### 2:20 to 2:50, X-ray viewer

Click to **X-ray viewer** (step 4).

- Click **cbBTC depeg -30%, in progress**, then click the **cbBTC** column. "Every number comes from the contracts: the oracle address, the liquidation incentive, the cash someone could borrow out."
- If there's time: "Give me any Morpho vault address." Paste it in **Or X-ray any Morpho vault**, press **X-ray it**. It loads in a few seconds.

### 2:50 to 3:00, close

"Loss is computed borrower by borrower, probabilities come from price history or a break-even when there's none, and everything is saved with a hash so it's reproducible. Thanks."

## If you get 5 minutes instead of 3

Add, in this order:

1. **Vault details** (step 5): show the loss decomposition (existing bad debt / scenario loss / unpriced) and the reverse stress test (the shock size that breaks your 10% limit).
2. **PT case** (step 6): "This is the brief's own example, a leveraged PT-sUSDe loan. The lending oracle uses a fixed 6% discount instead of the Pendle market price, and here are real quotes for selling 25%, 50% or all of it."

## Numbers to know by heart

| | |
|---|---|
| Book | 10 Morpho vaults, 77 markets, 7,931 borrower positions, $1M hypothetical per vault |
| Steakhouse USDC | $65.3M, 11 markets, cbBTC 43% of it, 78% behind depeg-blind oracles |
| BTC −35%, sudden | $5,141 loss on $1M; happened in 0.7% of 30-day windows since 2015; expected loss $36 vs $3,541 exit cost: stay |
| BTC −35%, gradual | $0, liquidations work |
| cbBTC depeg −35%, in progress | $12,432 loss vs $3,541 exit cost: exit |
| WBTC depeg −35% | $0, its oracle reads WBTC/BTC |
| Liquidator break-even at 86% LLTV | 4.2% (Morpho liquidation incentive 4.4%) |
| Book, cbBTC depeg in progress | 8 of 10 vaults exposed, 4 exits, about $67,000 total loss |
| Shared | BTC/USD feed under 32% of the book, cbBTC under 26% |
| Aave v3 | $23.9B collateral-enabled supply, 42% behind depeg-blind oracles; cbBTC $1.44B priced with BTC/USD; USDe $316M priced with USDT/USD |
| Spark | $5.9B; cbBTC, LBTC and tBTC priced with an aggregated BTC/USD feed |

## Q&A

### About the method

**How do you find the dependencies?**
Three sources. Morpho's API gives each vault's markets and every borrower, paged until the borrower shares add up to the market total. Then I call each oracle contract directly on Ethereum to get its price feeds, and each feed's `description()`, all at one block. The issuer and custodian layer is a small hand-written list with a source for each token.

**How do you know whether an oracle can "see" a depeg?**
From what it reads. If there's a feed for the token itself against its underlying (WBTC/BTC), it sees it. If it only reads the underlying (BTC/USD for cbBTC), it doesn't. If it reads the issuer's exchange rate (weETH/ETH exchange rate), it reports what the protocol says, not what the market pays. Feeds I can't classify are marked "unverified" and their response becomes an explicit assumption you can change.

**Did you check the oracle data?**
Yes. Morpho's API also reports oracle feeds; I compared it with my on-chain reads and found no mismatches. The cbBTC feed is the Chainlink BTC/USD contract, which you can confirm on Etherscan.

**How is the loss calculated?**
Per borrower: shortfall = max(0, debt − collateral × (1 − shock) × (1 − sale discount)). One borrower's extra collateral can't cover another's shortfall. The vault takes its share of each market's loss, and the position takes its share of the vault.

**Why is the gradual case $0?**
On Morpho a liquidator repays the debt and receives the collateral plus a bonus, 4.4% at 86% LLTV. If they can sell the collateral within about 4.2% of the oracle price, liquidating is profitable, so borrowers get liquidated before they go underwater. If the sale discount is bigger than that, or the oracle can't see the drop, liquidations stop and lenders take the loss. You can move the discount slider to see it flip.

**Why does a blind oracle make it worse than a normal crash?**
Two reasons. Nobody gets liquidated, because the oracle thinks the collateral is fine. And anyone can buy the cheap token, post it at the oracle price and borrow the market's cash, so the market gets drained. That second effect is included, limited to the cash actually in the market.

### About the decision

**Where does the probability come from?**
For price drops, from counting how often a drop that size happened in 30-day windows of daily BTC and ETH prices since 2015. A depeg has no usable history, so I don't invent a number: I show the break-even probability, and you can type your own. If a shock never happened in the data, I don't treat that as 0%.

**What's the exit cost?**
Leaving a vault redeems at share price, so the cost is the yield you give up over the horizon plus gas. There's a field for extra exit cost if you want to add slippage, like the 11% in Belem's brief. The PT case uses real sale quotes.

**What does "in progress" mean?**
The event is already happening, which is Belem's scenario: a pocket is hit. Then the probability is 100% and the question is only whether staying costs more than leaving.

**Why would it say exit when the expected loss is small?**
If exiting only pays off above a 1% chance and the event would break your loss limit, the verdict is exit. That's cheap insurance against a tail you can't afford.

### About scope and limits

**Is this only Morpho?**
The dollar loss model is Morpho, borrower by borrower. The oracle scan also runs on Aave v3 and Spark, and finds the same blind spot there. Aave pools collateral across all users, so a borrower-level loss for Aave needs a different data source. That's the next step.

**What's not modelled?**
How much DEX liquidity liquidators actually have, fresh cash being moved into a drained market, and the order in which depositors exit. Probabilities for depegs aren't modelled either.

**Is the cbBTC oracle choice a mistake by the curators?**
Not necessarily. Pricing cbBTC as BTC avoids liquidating people over short, small depegs. Fulcrum doesn't say it's wrong; it says what you're accepting by holding it, in dollars, so you can decide.

**Are these Belem's positions?**
No. The vaults are real and public. The $1M per vault is hypothetical.

**Can it run on fresh data?**
Yes. One script re-captures everything (`node scripts/capture-book.js`), and the X-ray viewer can capture any Morpho vault live from its address.

### About you

**Did you build this alone?**
Yes, solo.

**Did you use AI?**
If asked, be honest. Something like: "Yes, I used AI coding tools heavily to build it fast. I made the calls on what to model and checked the numbers against the chain." Judges respect a straight answer much more than a dodge, and they will notice a dodge.

## If something breaks

- **3D page blank:** the Wi-Fi is probably down. Skip to Book; it doesn't need the internet.
- **Page stuck loading:** press Ctrl+F5. If it's still stuck, restart the server.
- **Live vault capture fails:** "It reads Morpho's API live; the network here is blocking it." Then show a vault from the book.
- **Laptop dies:** play the backup video.

## Submission checklist

- [ ] Code on GitHub, public, README at the top level
- [ ] 2 to 3 minute screen recording of the demo above (Win+Alt+R to start and stop on Windows)
- [ ] Submission form filled in: project name "Fulcrum", one-line description, repo link, video link
- [ ] Rehearse the 3-minute script out loud with a timer, twice
