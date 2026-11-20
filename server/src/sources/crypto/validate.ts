export type Chain = 'btc' | 'eth' | 'base' | 'bsc'
export const CHAINS: readonly Chain[] = ['btc', 'eth', 'base', 'bsc']

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
// Legacy: base58, starts with 1 or 3 (25 to 34 chars, no 0 O I l). Segwit/taproot: bech32, starts with bc1.
const BTC_BASE58 = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/
const BTC_BECH32 = /^bc1[02-9ac-hj-np-z]{11,87}$/

export function isChain(value: unknown): value is Chain {
  return typeof value === 'string' && (CHAINS as readonly string[]).includes(value)
}

export function isEvmChain(chain: Chain): chain is 'eth' | 'base' | 'bsc' {
  return chain === 'eth' || chain === 'base' || chain === 'bsc'
}

/**
 * Format-only validation (no checksum), returning the form that is stored and compared.
 * EVM and bech32 addresses are case-insensitive, so they are lowercased. Base58 is case-sensitive and kept as is.
 * Returns null when the address is malformed for the chain.
 */
export function normalizeAddress(chain: Chain, input: string): string | null {
  const address = input.trim()
  if (isEvmChain(chain)) {
    return EVM_ADDRESS.test(address) ? address.toLowerCase() : null
  }
  if (BTC_BASE58.test(address)) return address
  // bech32 must not mix upper and lower case; an all-uppercase form is valid and lowercased.
  if (address === address.toLowerCase() || address === address.toUpperCase()) {
    const lower = address.toLowerCase()
    if (BTC_BECH32.test(lower)) return lower
  }
  return null
}

/** Contract addresses follow the EVM rule on any EVM chain. */
export function normalizeContract(input: string): string | null {
  return normalizeAddress('eth', input)
}
