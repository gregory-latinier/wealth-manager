// Keccak-256 as Ethereum uses it (the original padding byte 0x01, not the 0x06 of NIST SHA3-256, so node:crypto cannot be used).
// Only needed to derive event topics and function selectors, so it favours being short and checkable over being fast.

const MASK = (1n << 64n) - 1n

const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]

// Rotation offsets, indexed by x + 5 * y.
const ROTATION = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14]

const rotl = (v: bigint, n: number): bigint => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK)

function permute(s: bigint[]): void {
  for (const rc of ROUND_CONSTANTS) {
    const c = [0, 1, 2, 3, 4].map((x) => s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20])
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1)
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d
    }
    const b: bigint[] = new Array(25).fill(0n)
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 5; y++) b[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROTATION[x + 5 * y])
    }
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 25; y += 5) s[x + y] = b[x + y] ^ (~b[((x + 1) % 5) + y] & MASK & b[((x + 2) % 5) + y])
    }
    s[0] ^= rc
  }
}

/** Keccak-256 of the bytes, as 32 bytes. */
export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136
  const padded = new Uint8Array(Math.ceil((input.length + 1) / rate) * rate)
  padded.set(input)
  padded[input.length] ^= 0x01
  padded[padded.length - 1] ^= 0x80

  const state: bigint[] = new Array(25).fill(0n)
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n
      for (let j = 7; j >= 0; j--) lane = (lane << 8n) | BigInt(padded[offset + i * 8 + j])
      state[i] ^= lane
    }
    permute(state)
  }

  const out = new Uint8Array(32)
  for (let i = 0; i < 4; i++) for (let j = 0; j < 8; j++) out[i * 8 + j] = Number((state[i] >> BigInt(8 * j)) & 0xffn)
  return out
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** `0x…` hash of a UTF-8 string. An event topic is the hash of its signature, a selector is the first 4 bytes of one. */
export const keccakHex = (text: string): string => `0x${toHex(keccak256(new TextEncoder().encode(text)))}`
