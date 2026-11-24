import type { Decimal } from '../../../lib/money'

export type ProviderErrorKind = 'timeout' | 'network' | 'http' | 'rpc' | 'malformed'

/** Every provider failure is one of these, so the source type can report it instead of valuing it at 0. */
export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly kind: ProviderErrorKind,
    message: string
  ) {
    super(`${provider}: ${message}`)
    this.name = 'ProviderError'
  }
}

export type EvmChain = 'eth' | 'base' | 'bsc' | 'arb'
/** A chain whose tokens can be tracked. */
export type TokenChain = EvmChain | 'sol'

export interface BtcProvider {
  /** Confirmed balance in BTC. Unconfirmed transactions are ignored. */
  getBalance(address: string): Promise<Decimal>
}

export interface SolProvider {
  /** Finalized balance of the address in SOL. Tokens (SPL) are not read. */
  getBalance(address: string): Promise<Decimal>
}

export interface TokenRef {
  /** Lowercase contract address. */
  contract: string
  decimals: number
}

export type TokenBalance = { ok: true; balance: Decimal } | { ok: false; error: ProviderError }

export interface EvmBalances {
  /** Native coin (ETH, or BNB on BNB Chain) balance of the address. */
  native: Decimal
  /** One entry per requested token, keyed by lowercase contract. A bad token never hides the others. */
  tokens: Record<string, TokenBalance>
}

export interface TokenMetadata {
  symbol: string
  decimals: number
}

export interface EvmProvider {
  getBalances(chain: EvmChain, address: string, tokens: TokenRef[]): Promise<EvmBalances>
  getTokenMetadata(chain: EvmChain, contract: string): Promise<TokenMetadata>
}

/** `bnb` and `sol` are optional on purpose: if the provider omits one, only the addresses on that chain fail, not the whole snapshot. */
export interface NativePrices {
  btc: Decimal
  eth: Decimal
  bnb?: Decimal
  sol?: Decimal
}

export interface PriceProvider {
  getNativePrices(): Promise<NativePrices>
  /** USD prices by lowercase contract. A contract the provider does not know is absent from the map (unpriced). */
  getTokenPrices(chain: EvmChain, contracts: string[]): Promise<Map<string, Decimal>>
}

/** One SPL token account of a Solana wallet. The mint is case-sensitive and is kept exactly as the chain writes it. */
export interface SplBalance {
  mint: string
  decimals: number
  /** Human amount (already divided by 10^decimals). */
  balance: Decimal
}

export interface SolTokenProvider {
  /** Every SPL token the wallet holds, zero balances included. A failed read throws: it is not an empty wallet. */
  getTokenBalances(address: string): Promise<SplBalance[]>
  /** Decimals of a mint, read from the chain. Throws for an address that is not a mint. */
  getMintDecimals(mint: string): Promise<number>
}

/** What DefiLlama knows about a Solana mint. The symbol is the provider's, so it is cleaned before it is stored. */
export interface SplPrice {
  priceUsd: Decimal
  symbol: string
}

export interface SolTokenPriceProvider {
  /**
   * USD price by mint. Mints are case-sensitive here and are never lowercased: two mints can differ by case alone.
   * A mint the provider does not know, or prices at 0, is absent from the map (unpriced), never valued at 0.
   */
  getSplPrices(mints: string[]): Promise<Map<string, SplPrice>>
}
