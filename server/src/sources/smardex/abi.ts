import { keccakHex } from '../../lib/keccak'

// Smardex USDN protocol on Ethereum mainnet (the WSTETH_USDN market). A position is not an NFT: it is the triple below.
export const PROTOCOL = '0x656cb8c6d154aad29d8771384089be5b5141f01a'
// Positions can be parked here to earn rewards. The protocol then lists this contract as the owner.
export const LONG_FARMING = '0xf9d36078a248af249af27ae1d5d0c1033d6bbe27'
// The router most front ends send open/close/transfer calls through.
export const UNIVERSAL_ROUTER = '0x49f66b1616865b2a59caecb8352bbf2ac80983e1'
export const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0'
export const WSTETH_DECIMALS = 18

export interface PositionId {
  tick: number
  tickVersion: string
  index: string
}

export const positionKey = (p: PositionId) => `${p.tick}:${p.tickVersion}:${p.index}`

const ADDRESS_ZERO = '0x' + '0'.repeat(40)
const POSITION_ID = '(int24,uint256,uint256)'
const selector = (signature: string) => keccakHex(signature).slice(0, 10)

export const SELECTORS = {
  getLongPosition: selector(`getLongPosition(${POSITION_ID})`),
  getPositionValue: selector(`getPositionValue(${POSITION_ID},uint128,uint128)`),
  // LongFarming takes the three fields as separate arguments, not as a struct.
  getPositionInfo: selector('getPositionInfo(int24,uint256,uint256)'),
  // Price at which the tick is liquidated (18 decimals). The tick of a position already includes its liquidation penalty.
  getEffectivePriceForTick: selector('getEffectivePriceForTick(int24)'),
}

export const TOPICS = {
  initiatedOpen: keccakHex(`InitiatedOpenPosition(address,address,uint40,uint128,uint128,uint128,${POSITION_ID})`),
  validatedOpen: keccakHex(`ValidatedOpenPosition(address,address,uint128,uint128,${POSITION_ID})`),
  ownershipTransferred: keccakHex(`PositionOwnershipTransferred(${POSITION_ID},address,address)`),
}

const MASK_256 = (1n << 256n) - 1n
const word = (value: bigint) => (value & MASK_256).toString(16).padStart(64, '0')

/** One 32-byte word per field. A negative tick is two's complement over the full 256 bits. */
export function encodePositionId(p: PositionId): string {
  return word(BigInt(p.tick)) + word(BigInt(p.tickVersion)) + word(BigInt(p.index))
}

export const encodeGetLongPosition = (p: PositionId) => SELECTORS.getLongPosition + encodePositionId(p)
export const encodeGetPositionInfo = (p: PositionId) => SELECTORS.getPositionInfo + encodePositionId(p)
export const encodeGetEffectivePriceForTick = (tick: number) => SELECTORS.getEffectivePriceForTick + word(BigInt(tick))

export function encodeGetPositionValue(p: PositionId, price: bigint, timestamp: bigint): string {
  return SELECTORS.getPositionValue + encodePositionId(p) + word(price) + word(timestamp)
}

function words(data: string): bigint[] {
  const hex = data.replace(/^0x/, '')
  const out: bigint[] = []
  for (let i = 0; i + 64 <= hex.length; i += 64) out.push(BigInt('0x' + hex.slice(i, i + 64)))
  return out
}

const toAddress = (w: bigint) => '0x' + w.toString(16).padStart(40, '0')
const toPositionId = (w: bigint[]): PositionId => ({
  tick: Number(BigInt.asIntN(256, w[0])),
  tickVersion: w[1].toString(),
  index: w[2].toString(),
})

export interface LongPosition {
  validated: boolean
  /** Owner as the protocol sees it: the trader, or the LongFarming contract. Zero for a closed or liquidated position. */
  user: string
  /** Collateral in wei of wstETH. */
  amount: bigint
  /** Size of the trade in wei of wstETH: collateral times leverage. */
  totalExpo: bigint
}

/** `getLongPosition` returns the Position struct and the liquidation penalty inline (six static words). */
export function decodeLongPosition(result: string): LongPosition {
  const w = words(result)
  if (w.length < 6) throw new Error('getLongPosition: result is too short')
  return { validated: w[0] === 1n, user: toAddress(w[2]), totalExpo: w[3], amount: w[4] }
}

/** An 18-decimal fixed-point result such as a price. */
export function decodeUint(result: string): bigint {
  const w = words(result)
  if (w.length < 1) throw new Error('result is too short')
  return w[0]
}

/** First word of the PositionInfo struct is the owner. The zero address means the position is not farmed. */
export function decodePositionInfoOwner(result: string): string {
  const w = words(result)
  if (w.length < 1) throw new Error('getPositionInfo: result is too short')
  return toAddress(w[0])
}

/** `getPositionValue` returns an int256 in wei of wstETH. Negative means the position is under water. */
export function decodeInt256(result: string): bigint {
  const w = words(result)
  if (w.length < 1) throw new Error('result is too short')
  return BigInt.asIntN(256, w[0])
}

/** EIP-55 mixed-case form. Blockscout's v2 API answers HTTP 500 for an all-lowercase address, so requests must use this. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '')
  const hash = keccakHex(lower).slice(2)
  let out = '0x'
  for (let i = 0; i < lower.length; i++) out += parseInt(hash[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i]
  return out
}

export const isZeroAddress =(address: string) => address.toLowerCase() === ADDRESS_ZERO

/** What an opening event says about how a position was opened. Both fields are optional: a hand-over event says nothing about it. */
export interface PositionOpening {
  /** Unix seconds. */
  openedAt?: number
  /** Price of one wstETH in USD when the position was opened, as the raw 18-decimal integer in a string. */
  entryPrice?: string
}

/** A position id plus whatever is known about its opening. */
export type DiscoveredPosition = PositionId & PositionOpening

export interface OwnedPositionEvent {
  /** The address that must own the position for the event to matter. Lowercase. */
  owner: string
  posId: PositionId
  opening?: PositionOpening
  /** True when `opening.entryPrice` is the final one (ValidatedOpenPosition) and must win over the one at initiation. */
  validated?: boolean
}

/**
 * Positions an event hands to an owner. Open events carry the owner in topic 1 and the id at the end of the data,
 * the transfer event carries the new owner in topic 2 and the id first. Anything else returns null.
 */
export function parsePositionEvent(topics: Array<string | null>, data: string): OwnedPositionEvent | null {
  const topic0 = topics[0]?.toLowerCase()
  const w = words(data)
  const topicAddress = (t: string | null | undefined) => (t ? toAddress(BigInt(t)) : null)

  if (topic0 === TOPICS.initiatedOpen && w.length >= 7) {
    const owner = topicAddress(topics[1])
    // data: timestamp, totalExpo, amount, startPrice, then the id.
    return owner ? { owner, posId: toPositionId(w.slice(4, 7)), opening: { openedAt: Number(w[0]), entryPrice: w[3].toString() } } : null
  }
  if (topic0 === TOPICS.validatedOpen && w.length >= 5) {
    const owner = topicAddress(topics[1])
    // data: totalExpo, newStartPrice, then the id.
    return owner ? { owner, posId: toPositionId(w.slice(2, 5)), opening: { entryPrice: w[1].toString() }, validated: true } : null
  }
  if (topic0 === TOPICS.ownershipTransferred && w.length >= 3) {
    const owner = topicAddress(topics[2])
    return owner ? { owner, posId: toPositionId(w.slice(0, 3)) } : null
  }
  return null
}
