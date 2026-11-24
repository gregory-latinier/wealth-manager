import type { EvmChain } from './providers/types'

export type Chain = 'btc' | 'sol' | EvmChain
export const EVM_CHAINS: readonly EvmChain[] = ['eth', 'base', 'bsc', 'arb']
export const CHAINS: readonly Chain[] = ['btc', ...EVM_CHAINS, 'sol']

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
// Legacy: base58, starts with 1 or 3 (25 to 34 chars, no 0 O I l). Segwit/taproot: bech32, starts with bc1.
const BTC_BASE58 = /^[13][1-9A-HJ-NP-Za-km-z]{24,33}$/
const BTC_BECH32 = /^bc1[02-9ac-hj-np-z]{11,87}$/
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const SOLANA_ADDRESS_BYTES = 32

export function isChain(value: unknown): value is Chain {
  return typeof value === 'string' && (CHAINS as readonly string[]).includes(value)
}

export function isEvmChain(chain: Chain): chain is EvmChain {
  return (EVM_CHAINS as readonly string[]).includes(chain)
}

/** Number of bytes a base58 string decodes to, or null when it has a character outside the alphabet. */
function base58ByteLength(value: string): number | null {
  let n = 0n
  for (const ch of value) {
    const digit = BASE58.indexOf(ch)
    if (digit < 0) return null
    n = n * 58n + BigInt(digit)
  }
  // Each leading "1" is a zero byte that the number itself cannot carry.
  let zeros = 0
  while (zeros < value.length && value[zeros] === '1') zeros++
  return zeros + (n === 0n ? 0 : Math.ceil(n.toString(16).length / 2))
}

/**
 * A Solana address is a 32 byte public key in base58. Checking the decoded length (not only the alphabet) is what tells
 * it apart from a Bitcoin legacy address, which is also base58 but decodes to 25 bytes.
 */
function isSolanaAddress(value: string): boolean {
  return value.length >= 32 && value.length <= 44 && base58ByteLength(value) === SOLANA_ADDRESS_BYTES
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
  if (chain === 'sol') return isSolanaAddress(address) ? address : null
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
