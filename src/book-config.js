/** The illustrative book: ten real public Morpho vaults on Ethereum, one 10% pocket each.
 * The vaults are real; the equal weights and the book size are hypothetical, and none of
 * these holdings is attributed to Belem Capital. */
export const BOOK_SIZE_USD = 10_000_000;
export const BOOK = [
  { id: 'steakhouse-usdc', address: '0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB', note: 'Blue-chip BTC/ETH lending plus a EUR vault-share market' },
  { id: 'steakhouse-usdt', address: '0xbEef047a543E45807105E51A8BBEFCc5950fcfBa', note: 'Same curator, USDT book, gold (XAUt) collateral' },
  { id: 'gauntlet-usdc-prime', address: '0xdd0f28e19C1780eb6396170735D45153D261490d', note: 'Different curator, similar collateral set' },
  { id: 'spark-blue-chip-usdc', address: '0x56A76b428244a50513ec81e225a293d128fd581D', note: 'Two markets: cbBTC and wstETH' },
  { id: 'smokehouse-usdt', address: '0xA0804346780b4c2e3bE118ac957D1DB82F9d7484', note: 'Pendle PTs, synthetic dollars and blue chips' },
  { id: 'smokehouse-usdc', address: '0xBEeFFF209270748ddd194831b3fa287a5386f5bC', note: 'RWA and synthetic-dollar collateral' },
  { id: 'gauntlet-usdc-rwa', address: '0xA8875aaeBc4f830524e35d57F9772FfAcbdD6C45', note: 'Tokenised credit and RWA collateral' },
  { id: 'gauntlet-dai-core', address: '0x500331c9fF24D9d11aee6B07734Aa72343EA74a5', note: 'Ethena exposure: USDe, sUSDe, PT-USDe' },
  { id: 'steakhouse-eth', address: '0xBEEf050ecd6a16c4e7bfFbB52Ebba7846C4b8cD4', note: 'WETH book: staked-ETH and cbBTC collateral' },
  { id: 'gauntlet-weth-prime', address: '0x2371e134e3455e0593363cBF89d3b6cf53740618', note: 'WETH book: liquid staking and restaking' }
];
