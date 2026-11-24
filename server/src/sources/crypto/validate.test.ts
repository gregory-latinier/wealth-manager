import { isChain, isEvmChain, normalizeAddress, normalizeContract } from './validate'

// Wrapped SOL mint: a real 32 byte key. The system program is 32 zero bytes, written as 32 "1".
const SOLANA = 'So11111111111111111111111111111111111111112'
const SYSTEM_PROGRAM = '11111111111111111111111111111111'
const EVM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const P2SH = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy'
const BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

describe('normalizeAddress', () => {
  it('lowercases EVM addresses on eth, base, bsc and arb', () => {
    expect(normalizeAddress('eth', EVM)).toBe(EVM.toLowerCase())
    expect(normalizeAddress('base', ` ${EVM} `)).toBe(EVM.toLowerCase())
    expect(normalizeAddress('bsc', EVM)).toBe(EVM.toLowerCase())
    expect(normalizeAddress('arb', EVM)).toBe(EVM.toLowerCase())
  })

  it('keeps the case of a Solana address, which is base58', () => {
    expect(normalizeAddress('sol', SOLANA)).toBe(SOLANA)
    expect(normalizeAddress('sol', ` ${SOLANA} `)).toBe(SOLANA)
    expect(normalizeAddress('sol', SYSTEM_PROGRAM)).toBe(SYSTEM_PROGRAM)
  })

  it.each([
    ['an EVM address', EVM],
    ['a Bitcoin legacy address (base58, but 25 bytes)', LEGACY],
    ['a bech32 address', BECH32],
    ['base58 with an ambiguous character (0)', SOLANA.slice(0, -1) + '0'],
    ['one character too short (31 bytes)', SOLANA.slice(1)],
    ['one character too long (33 bytes)', SOLANA + 'A'],
    ['empty', ''],
  ])('rejects a Solana address that is %s', (_name, value) => {
    expect(normalizeAddress('sol', value)).toBeNull()
  })

  it('does not accept a Solana address on another chain', () => {
    expect(normalizeAddress('btc', SOLANA)).toBeNull()
    expect(normalizeAddress('eth', SOLANA)).toBeNull()
    expect(normalizeAddress('arb', SOLANA)).toBeNull()
  })

  it('knows which chains are EVM', () => {
    expect(['btc', 'eth', 'base', 'bsc', 'arb', 'sol'].filter((c) => isChain(c) && isEvmChain(c))).toEqual(['eth', 'base', 'bsc', 'arb'])
    expect(isChain('doge')).toBe(false)
  })

  it.each([
    ['too short', '0x1234'],
    ['no prefix', EVM.slice(2)],
    ['non-hex', '0x' + 'g'.repeat(40)],
    ['too long', EVM + '00'],
    ['empty', ''],
  ])('rejects an EVM address that is %s', (_name, value) => {
    expect(normalizeAddress('eth', value)).toBeNull()
  })

  it('accepts legacy, P2SH and bech32 BTC addresses, keeping base58 case', () => {
    expect(normalizeAddress('btc', LEGACY)).toBe(LEGACY)
    expect(normalizeAddress('btc', P2SH)).toBe(P2SH)
    expect(normalizeAddress('btc', BECH32)).toBe(BECH32)
  })

  it('lowercases an all-uppercase bech32 address but rejects mixed case', () => {
    expect(normalizeAddress('btc', BECH32.toUpperCase())).toBe(BECH32)
    expect(normalizeAddress('btc', 'bc1qAr0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq')).toBeNull()
  })

  it.each([
    ['an EVM address', EVM],
    ['base58 with an ambiguous character (0)', '1A1zP1eP5QGefi2DMPTfTL5SLmv7Div0Na'],
    ['a testnet address', 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'],
    ['too short', '1A1zP1'],
  ])('rejects a BTC address that is %s', (_name, value) => {
    expect(normalizeAddress('btc', value)).toBeNull()
  })

  it('does not accept a BTC address on an EVM chain or the reverse', () => {
    expect(normalizeAddress('eth', LEGACY)).toBeNull()
    expect(normalizeAddress('btc', EVM)).toBeNull()
    expect(normalizeAddress('bsc', LEGACY)).toBeNull()
  })
})

describe('normalizeContract', () => {
  it('applies the EVM rule', () => {
    expect(normalizeContract(EVM)).toBe(EVM.toLowerCase())
    expect(normalizeContract('nope')).toBeNull()
  })
})
