import {
  LONG_FARMING,
  PROTOCOL,
  TOPICS,
  decodeInt256,
  decodeLongPosition,
  decodePositionInfoOwner,
  decodeUint,
  encodeGetEffectivePriceForTick,
  encodeGetPositionValue,
  encodePositionId,
  parsePositionEvent,
  SELECTORS,
  toChecksumAddress,
} from './abi'

const OWNER = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'
const word = (v: bigint) => (v & ((1n << 256n) - 1n)).toString(16).padStart(64, '0')
const topicOf = (address: string) => '0x' + address.replace('0x', '').padStart(64, '0')

describe('encodePositionId', () => {
  it('writes three 32-byte words', () => {
    expect(encodePositionId({ tick: 64300, tickVersion: '2', index: '7' })).toBe(word(64300n) + word(2n) + word(7n))
  })

  it('encodes a negative tick as 256-bit two complement', () => {
    const encoded = encodePositionId({ tick: -100, tickVersion: '0', index: '0' })
    expect(encoded.slice(0, 64)).toBe('f'.repeat(62) + '9c')
  })

  it('appends price and timestamp after the id for getPositionValue', () => {
    const data = encodeGetPositionValue({ tick: 1, tickVersion: '0', index: '0' }, 5n, 6n)
    expect(data).toMatch(/^0x[0-9a-f]{8}/)
    expect(data.slice(10)).toBe(word(1n) + word(0n) + word(0n) + word(5n) + word(6n))
  })
})

describe('getEffectivePriceForTick', () => {
  it('encodes the tick as one signed word after the selector', () => {
    expect(encodeGetEffectivePriceForTick(64300)).toBe(SELECTORS.getEffectivePriceForTick + word(64300n))
    expect(encodeGetEffectivePriceForTick(-100).slice(10, 74)).toBe('f'.repeat(62) + '9c')
  })

  it('decodes an 18-decimal price and rejects an empty result', () => {
    expect(decodeUint('0x' + word(710n * 10n ** 18n))).toBe(710n * 10n ** 18n)
    expect(() => decodeUint('0x')).toThrow()
  })
})

describe('toChecksumAddress', () => {
  it('matches the EIP-55 reference vector', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')
  })

  it('matches the address Blockscout accepts for this wallet', () => {
    expect(toChecksumAddress(OWNER)).toBe('0x806bE92538e21D63EfF9681F5b96dd4f52BFFF31')
  })
})

describe('decoders', () => {
  it('reads owner and amount from getLongPosition (validated, timestamp, user, totalExpo, amount, penalty)', () => {
    const result = '0x' + word(1n) + word(1700000000n) + word(BigInt(OWNER)) + word(9n) + word(123n) + word(4n)
    expect(decodeLongPosition(result)).toEqual({ validated: true, user: OWNER, totalExpo: 9n, amount: 123n })
  })

  it('rejects a short getLongPosition result instead of reading zeros', () => {
    expect(() => decodeLongPosition('0x' + word(1n))).toThrow('too short')
  })

  it('reads the owner from LongFarming getPositionInfo', () => {
    expect(decodePositionInfoOwner('0x' + word(BigInt(OWNER)) + word(1n))).toBe(OWNER)
  })

  it('decodes a negative int256', () => {
    expect(decodeInt256('0x' + 'f'.repeat(64))).toBe(-1n)
    expect(decodeInt256('0x' + word(42n))).toBe(42n)
  })

  it('treats an empty result as an error', () => {
    expect(() => decodeInt256('0x')).toThrow()
  })
})

describe('parsePositionEvent', () => {
  const posWords = word(64300n) + word(0n) + word(0n)

  it('reads the owner and id from InitiatedOpenPosition', () => {
    // data: timestamp, totalExpo, amount, startPrice, then the id.
    const data = '0x' + word(1n) + word(2n) + word(3n) + word(4n) + posWords
    expect(parsePositionEvent([TOPICS.initiatedOpen, topicOf(OWNER), topicOf(OWNER)], data)).toEqual({
      owner: OWNER,
      posId: { tick: 64300, tickVersion: '0', index: '0' },
      // The date and the price at initiation, which the validation may refine.
      opening: { openedAt: 1, entryPrice: '4' },
    })
  })

  it('reads the owner, id and final entry price from ValidatedOpenPosition', () => {
    // data: totalExpo, newStartPrice, then the id.
    const data = '0x' + word(1n) + word(2n) + posWords
    expect(parsePositionEvent([TOPICS.validatedOpen, topicOf(OWNER), topicOf(OWNER)], data)).toEqual({
      owner: OWNER,
      posId: { tick: 64300, tickVersion: '0', index: '0' },
      opening: { entryPrice: '2' },
      validated: true,
    })
  })

  it('gives a transferred position to the NEW owner, not the old one', () => {
    const data = '0x' + posWords
    const event = parsePositionEvent([TOPICS.ownershipTransferred, topicOf(LONG_FARMING), topicOf(OWNER)], data)
    expect(event?.owner).toBe(OWNER)
  })

  it('ignores other events and truncated data', () => {
    expect(parsePositionEvent([topicOf(PROTOCOL)], '0x')).toBeNull()
    expect(parsePositionEvent([TOPICS.initiatedOpen, topicOf(OWNER)], '0x' + word(1n))).toBeNull()
  })

  it('decodes a negative tick from an event', () => {
    const data = '0x' + word(-200n) + word(3n) + word(1n)
    expect(parsePositionEvent([TOPICS.ownershipTransferred, topicOf(PROTOCOL), topicOf(OWNER)], data)?.posId).toEqual({
      tick: -200,
      tickVersion: '3',
      index: '1',
    })
  })
})
