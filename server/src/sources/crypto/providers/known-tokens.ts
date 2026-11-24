import { dec } from '../../../lib/money'
import type { ScanProvider, ScanSupport, ScanToken } from './blockscout'
import { createSolanaScan } from './solana-scan'
import type { EvmChain, EvmProvider, PriceProvider, SolTokenPriceProvider, SolTokenProvider, TokenChain } from './types'

interface KnownToken {
  /** Mixed case is fine here, it is lowercased on use. */
  contract: string
  symbol: string
  name: string
  decimals: number
}

/**
 * Popular tokens per chain. No keyless indexer lists an address's tokens on Base or BNB Chain, so the scan
 * asks the chain directly about this list (one batched RPC call). Symbols and decimals were read back from
 * the contracts. Note that USDT and USDC have 18 decimals on BNB Chain but 6 on Base.
 * A token that is not listed here is added with the contract box instead.
 */
export const KNOWN_TOKENS: Partial<Record<EvmChain, KnownToken[]>> = {
  base: [
    { contract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { contract: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2', symbol: 'USDT', name: 'Tether USD', decimals: 6 },
    { contract: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA', symbol: 'USDbC', name: 'USD Base Coin', decimals: 6 },
    { contract: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { contract: '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42', symbol: 'EURC', name: 'EURC', decimals: 6 },
    { contract: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { contract: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf', symbol: 'cbBTC', name: 'Coinbase Wrapped BTC', decimals: 8 },
    { contract: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22', symbol: 'cbETH', name: 'Coinbase Wrapped Staked ETH', decimals: 18 },
    { contract: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452', symbol: 'wstETH', name: 'Wrapped stETH', decimals: 18 },
    { contract: '0x940181a94A35A4569E4529A3CDfB74e38FD98631', symbol: 'AERO', name: 'Aerodrome', decimals: 18 },
    { contract: '0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed', symbol: 'DEGEN', name: 'Degen', decimals: 18 },
  ],
  bsc: [
    { contract: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', name: 'Tether USD', decimals: 18 },
    { contract: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', name: 'USD Coin', decimals: 18 },
    { contract: '0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56', symbol: 'BUSD', name: 'Binance-Peg BUSD', decimals: 18 },
    { contract: '0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409', symbol: 'FDUSD', name: 'First Digital USD', decimals: 18 },
    { contract: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', name: 'Dai Token', decimals: 18 },
    { contract: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', name: 'Wrapped BNB', decimals: 18 },
    { contract: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', symbol: 'ETH', name: 'Binance-Peg Ethereum', decimals: 18 },
    { contract: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', symbol: 'BTCB', name: 'Binance-Peg BTCB', decimals: 18 },
    { contract: '0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82', symbol: 'CAKE', name: 'PancakeSwap Token', decimals: 18 },
    { contract: '0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE', symbol: 'XRP', name: 'Binance-Peg XRP', decimals: 18 },
  ],
  // Symbols and decimals read from the contracts on arb1.arbitrum.io. USDC and USDT are 6 decimals here, ARB and DAI are 18.
  arb: [
    { contract: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { contract: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC.e', name: 'Bridged USDC', decimals: 6 },
    { contract: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USD₮0', name: 'Tether USD', decimals: 6 },
    { contract: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18 },
    { contract: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
    { contract: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', name: 'Wrapped BTC', decimals: 8 },
    { contract: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB', name: 'Arbitrum', decimals: 18 },
  ],
}

const evmOnly = (chain: TokenChain): chain is EvmChain => chain !== 'sol'

/**
 * Scan source for chains without a keyless indexer: balances of a fixed token list over RPC, prices from CoinGecko.
 * A price failure leaves the tokens unpriced instead of failing the scan, so the owner still sees what is held.
 */
export function createKnownTokenScan(providers: { evm: EvmProvider; prices: PriceProvider }): ScanProvider {
  // Remembers which scans lost their prices. Scans are rare and one at a time, so a small map is enough.
  const priceFailed = new Set<string>()
  const key = (chain: EvmChain, address: string) => `${chain}:${address.toLowerCase()}`

  return {
    pricesUnavailable: (chain, address) => evmOnly(chain) && priceFailed.has(key(chain, address)),

    support(chain) {
      return evmOnly(chain) && KNOWN_TOKENS[chain] ? { enabled: true } : { enabled: false, reason: 'No known-token list for this chain.' }
    },

    async listTokens(chain, address) {
      if (!evmOnly(chain)) throw new Error(`the known-token scan does not handle ${chain}`)
      const known = KNOWN_TOKENS[chain] ?? []
      priceFailed.delete(key(chain, address))
      const refs = known.map((t) => ({ contract: t.contract.toLowerCase(), decimals: t.decimals }))
      const balances = await providers.evm.getBalances(chain, address, refs)

      // Only price what is actually held. A token whose balance read failed is skipped, not reported as empty.
      const held = known.filter((t) => {
        const b = balances.tokens[t.contract.toLowerCase()]
        return b?.ok && !b.balance.isZero()
      })
      if (held.length === 0) return []

      let prices = new Map<string, ReturnType<typeof dec>>()
      try {
        prices = await providers.prices.getTokenPrices(chain, held.map((t) => t.contract.toLowerCase()))
      } catch {
        // The tokens are still listed, unpriced, and the scan says the lookup failed so it is not read as "worthless".
        priceFailed.add(key(chain, address))
      }

      return held.map((t): ScanToken => {
        const contract = t.contract.toLowerCase()
        const b = balances.tokens[contract]
        return {
          contract,
          symbol: t.symbol,
          name: t.name,
          decimals: t.decimals,
          balance: b.ok ? b.balance : dec(0),
          priceUsd: prices.get(contract) ?? null,
          reputation: null,
        }
      })
    },
  }
}

/**
 * Ethereum keeps the keyless Blockscout scan, which discovers every token. The other EVM chains use the known-token list.
 * Solana reads the wallet's SPL token accounts, so it needs its own providers. Without them a Solana scan says it is disabled.
 */
export function createScanProvider(options: {
  evm: EvmProvider
  prices: PriceProvider
  ethereum: ScanProvider
  solana?: { tokens: SolTokenProvider; prices: SolTokenPriceProvider }
}): ScanProvider {
  const known = createKnownTokenScan(options)
  const sol = options.solana ? createSolanaScan(options.solana) : null
  const unavailable: ScanSupport = { enabled: false, reason: 'Solana token scanning is not configured.' }
  const pick = (chain: TokenChain): ScanProvider | null => (chain === 'sol' ? sol : chain === 'eth' ? options.ethereum : known)
  return {
    support: (chain) => pick(chain)?.support(chain) ?? unavailable,
    listTokens: async (chain, address) => {
      const provider = pick(chain)
      if (!provider) throw new Error('Solana token scanning is not configured')
      return provider.listTokens(chain, address)
    },
    pricesUnavailable: (chain, address) => pick(chain)?.pricesUnavailable?.(chain, address) ?? false,
  }
}
