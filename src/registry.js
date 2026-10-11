/** Curated token registry: the layers BELOW the collateral token that no indexer reports.
 * Every entry names who must keep the token worth its underlying, and which oracle feeds
 * would actually observe a break in that link. Entries are keyed by address and are only
 * applied when the on-chain symbol matches. Anything absent is shown as "not in registry". */

// Feed descriptions that observe a token's MARKET value against its underlying.
// Exchange-rate / redemption-rate feeds are deliberately NOT here: they report what the
// issuer's contract says, so they keep reporting par while the market price breaks.
export const TOKENS = {
  '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599': { symbol: 'WBTC', family: 'BTC', kind: 'Custodial wrapper', issuer: 'BitGo / BiT Global', role: 'Custodian holds the BTC backing', link: 'WBTC/BTC', peg: [/^WBTC\s*\/\s*BTC/i], source: 'https://wbtc.network' },
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': { symbol: 'cbBTC', family: 'BTC', kind: 'Custodial wrapper', issuer: 'Coinbase', role: 'Custodian holds the BTC backing', link: 'cbBTC/BTC', peg: [/^CBBTC\s*\/\s*(BTC|USD)/i], source: 'https://www.coinbase.com/cbbtc' },
  '0x8236a87084f8b84306f72007f36f2618a5634494': { symbol: 'LBTC', family: 'BTC', kind: 'Staked BTC', issuer: 'Lombard', role: 'Issuer and Babylon staking', link: 'LBTC/BTC', peg: [/^LBTC\s*\/\s*BTC/i], source: 'https://www.lombard.finance' },
  '0x18084fba666a33d37592fa2633fd49a74dd93a88': { symbol: 'tBTC', family: 'BTC', kind: 'Threshold-signed wrapper', issuer: 'Threshold Network', role: 'Signer set holds the BTC backing', link: 'tBTC/BTC', peg: [/^TBTC\s*\/\s*(BTC|USD)/i], source: 'https://threshold.network' },
  '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0': { symbol: 'wstETH', family: 'ETH', kind: 'Liquid staking', issuer: 'Lido', role: 'Validators and withdrawal queue', link: 'stETH/ETH', peg: [/^STETH\s*\/\s*(ETH|USD)/i], rate: [/exchange rate/i], source: 'https://docs.lido.fi' },
  '0xcd5fe23c85820f7b72d0926fc9b05b43e359b7ee': { symbol: 'weETH', family: 'ETH', kind: 'Liquid restaking', issuer: 'ether.fi', role: 'Validators, EigenLayer restaking, withdrawal queue', link: 'weETH/ETH', peg: [/^WEETH\s*\/\s*(ETH|USD)(?!.*exchange)/i], rate: [/exchange rate/i], source: 'https://etherfi.gitbook.io' },
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': { symbol: 'WETH', family: 'ETH', kind: 'Contract wrapper', issuer: 'WETH9 contract', role: 'Immutable 1:1 contract, no custodian', link: 'WETH/ETH', peg: [], immutable: true, source: 'https://etherscan.io/token/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' },
  '0x9d39a5de30e57443bff2a8307a4256c8797a3497': { symbol: 'sUSDe', family: 'USD', kind: 'Synthetic dollar (staked)', issuer: 'Ethena', role: 'Delta-neutral hedge on centralised exchanges', link: 'sUSDe/USD', peg: [/^SUSDE\s*\/\s*USD/i, /^USDE\s*\/\s*USD/i], rate: [/exchange rate/i], source: 'https://docs.ethena.fi' },
  '0x4c9edd5852cd905f086c759e8383e09bff1e68b3': { symbol: 'USDe', family: 'USD', kind: 'Synthetic dollar', issuer: 'Ethena', role: 'Delta-neutral hedge on centralised exchanges', link: 'USDe/USD', peg: [/^USDE\s*\/\s*USD/i], source: 'https://docs.ethena.fi' },
  '0xa3931d71877c0e7a3148cb7eb4463524fec27fbd': { symbol: 'sUSDS', family: 'USD', kind: 'Savings stablecoin', issuer: 'Sky (formerly Maker)', role: 'Collateralised stablecoin and savings rate', link: 'sUSDS/USD', peg: [/^USDS\s*\/\s*USD/i, /^SUSDS\s*\/\s*USD/i], rate: [/exchange rate|rate provider/i], source: 'https://sky.money' },
  '0x68749665ff8d2d112fa859aa293f07a622782f38': { symbol: 'XAUt', family: 'XAU', kind: 'Tokenised gold', issuer: 'Tether (TG Commodities)', role: 'Custodian holds allocated gold', link: 'XAUt/gold', peg: [/^XAUT\s*\/\s*USD/i], source: 'https://gold.tether.to' },
  '0xbeef0c075da5d01112ae5cf34d257074fb5ddb2f': { symbol: 'steakEURCV', family: 'EUR', kind: 'Vault share (EUR stablecoin)', issuer: 'SG-FORGE (Société Générale) via a Steakhouse Morpho vault', role: 'EURCV issuer reserves; the vault adds its own lending book', link: 'EURCV/EUR', peg: [/EURCV\s*\/\s*(EUR|USD)/i], source: 'https://www.sgforge.com' },
  '0x238a700ed6165261cf8b2e544ba797bc11e466ba': { symbol: 'mF-ONE', family: 'USD', kind: 'Tokenised fund share', issuer: 'Midas', role: 'Off-chain fund NAV and issuer redemption', link: 'mF-ONE/fund NAV', peg: [], rate: [/discounted|NAV/i], source: 'https://midas.app' },
  '0x5086bf358635b81d8c47c66d1c8b9e567db70c72': { symbol: 'reUSD', family: 'USD', kind: 'Yield-bearing dollar (reinsurance)', issuer: 'Re Protocol', role: 'Reinsurance collateral and issuer redemption', link: 'reUSD/USD', peg: [], rate: [/exchange rate/i], source: 'https://re.xyz' },
  '0x4614f7a56a3eb83b2ff9fa4b4b9575b28fb68644': { symbol: 'wFalconX', family: 'USD', kind: 'Credit-vault tranche', issuer: 'Pareto (Idle) credit vault lending to FalconX', role: 'Borrower FalconX repays the credit line', link: 'tranche/USDC', peg: [], rate: [/exchange rate/i], source: 'https://pareto.credit' },
  '0xc26a6fa2c37b38e549a4a1807543801db684f99c': { symbol: 'AA_FalconXUSDC', family: 'USD', kind: 'Credit-vault tranche', issuer: 'Pareto (Idle) credit vault lending to FalconX', role: 'Borrower FalconX repays the credit line', link: 'tranche/USDC', peg: [], rate: [/exchange rate/i], source: 'https://pareto.credit' },
  '0x14d60e7fdc0d71d8611742720e4c50e7a974020c': { symbol: 'USCC', family: 'USD', kind: 'Tokenised fund share', issuer: 'Superstate', role: 'Off-chain fund NAV and issuer redemption', link: 'USCC/fund NAV', peg: [], rate: [/NAV/i], source: 'https://superstate.com' },
  // Loan assets. A vault denominated in the same asset bears its peg risk regardless of any oracle.
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': { symbol: 'USDC', family: 'USD', kind: 'Fiat-backed stablecoin', issuer: 'Circle', role: 'Reserve custodian and redemption', link: 'USDC/USD', peg: [/^USDC\s*\/\s*USD/i], source: 'https://www.circle.com/usdc' },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': { symbol: 'USDT', family: 'USD', kind: 'Fiat-backed stablecoin', issuer: 'Tether', role: 'Reserve custodian and redemption', link: 'USDT/USD', peg: [/^USDT\s*\/\s*USD/i], source: 'https://tether.to' },
  '0x6b175474e89094c44da98b954eedeac495271d0f': { symbol: 'DAI', family: 'USD', kind: 'Collateralised stablecoin', issuer: 'Sky (formerly Maker)', role: 'Overcollateralised vaults and PSM', link: 'DAI/USD', peg: [/^DAI\s*\/\s*USD/i], source: 'https://sky.money' }
};

/** Symbol-shape rules for families of tokens with many addresses (e.g. Pendle PTs). */
export function lookupToken(address, symbol) {
  const entry = TOKENS[address?.toLowerCase()];
  if (entry && entry.symbol.toLowerCase() === String(symbol).toLowerCase()) return { ...entry, curated: true };
  if (/^PT-/i.test(symbol ?? '')) {
    const underlying = symbol.split('-')[1];
    return { symbol, family: /usd|dai|usds/i.test(underlying) ? 'USD' : /eth/i.test(underlying) ? 'ETH' : /btc/i.test(underlying) ? 'BTC' : null,
      kind: 'Pendle principal token', issuer: `Pendle + ${underlying} issuer`, role: 'Redeems 1:1 for the underlying at maturity; before that, priced by the Pendle AMM',
      link: `${symbol}/${underlying}`, peg: [/PT.*(TWAP|market|AMM)/i], rate: [/discount|linear/i], source: 'https://docs.pendle.finance', curated: true, rule: 'symbol' };
  }
  if (/on$/.test(symbol ?? '') && /^(SPY|QQQ|TSLA|FLHY)on$/.test(symbol)) {
    return { symbol, family: 'EQUITY', kind: 'Tokenised security', issuer: 'Ondo Global Markets', role: 'Custodian holds the underlying security', link: `${symbol}/${symbol.slice(0, -2)}`, peg: [], source: 'https://ondo.finance', curated: true, rule: 'symbol' };
  }
  return null;
}

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** What a market's oracle can see. Returns one of:
 *  sees        a feed reports the token's market value against its underlying
 *  rate        the oracle uses an issuer/contract rate, which keeps reporting par in a market break
 *  none        no input relates to the token at all (it is assumed to equal its underlying)
 *  unverified  an input names the token but its method (market vs rate) is not established
 *  unknown     oracle implementation not readable, or token not in the registry
 *  n/a         immutable 1:1 wrapper: there is no peg to break */
export function pegSight(token, oracle) {
  if (!token) return { state: 'unknown', reason: 'Token is not in the curated registry.' };
  if (token.immutable) return { state: 'n/a', reason: `${token.symbol} is an immutable 1:1 contract.` };
  if (!oracle || oracle.kind === 'unreadable') return { state: 'unknown', reason: 'Oracle implementation not traced (no Morpho Chainlink interface).' };
  const names = oracle.inputs.map(i => i.description ?? '');
  const hit = names.find(n => token.peg?.some(p => p.test(n)));
  if (hit) return { state: 'sees', reason: `Reads “${hit}”.` };
  const rate = names.find(n => token.rate?.some(p => p.test(n)));
  const mentions = names.find(n => new RegExp(escape(token.symbol.replace(/-\d.*$/, '')), 'i').test(n) || (/^PT-/.test(token.symbol) && /\bPT\b|pendle/i.test(n)));
  if (oracle.vault && !hit) return { state: 'rate', reason: `Uses the ${oracle.vault.symbol ?? 'vault'} conversion rate${names.length ? ` × ${names.filter(Boolean).join(' × ')}` : ''}; ${token.link} is assumed.` };
  if (rate) return { state: 'rate', reason: `Reads “${rate}”, an issuer/contract rate, not a market price.` };
  const generic = names.find(n => /^redstone price feed$|chainlink-compatible oracle/i.test(n));
  if (mentions || generic) return { state: 'unverified', reason: `Reads “${mentions ?? generic}”; whether it tracks the market or a rate is not established.` };
  return { state: 'none', reason: `No input observes ${token.link}; reads only ${names.filter(Boolean).map(n => `“${n}”`).join(' × ') || 'nothing'}.` };
}

/** Does the oracle respond to a move in the token's price family (e.g. BTC/USD)? */
export function familySight(family, oracle) {
  if (!family || !oracle || oracle.kind === 'unreadable') return { state: 'unknown', reason: 'Oracle implementation not traced.' };
  const pattern = { BTC: /\bBTC\b/i, ETH: /\b(ETH|stETH)\b/i, XAU: /\bXAU\b/i, EUR: /\bEUR\b/i, EQUITY: /\b(SPY|QQQ|TSLA)/i }[family];
  const hit = pattern && oracle.inputs.map(i => i.description ?? '').find(n => pattern.test(n));
  return hit ? { state: 'sees', reason: `Reads “${hit}”.` } : { state: 'unknown', reason: `No input names ${family}.` };
}

/** Morpho Blue liquidation incentive factor: min(1.15, 1 / (0.3·LLTV + 0.7)). */
export const liquidationIncentive = lltv => Math.min(1.15, 1 / (0.3 * lltv + 0.7));
