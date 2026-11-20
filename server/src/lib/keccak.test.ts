import { keccakHex } from './keccak'

describe('keccak256', () => {
  // Published vectors, so a wrong rotation table or padding byte fails here and not in a log query.
  it('hashes the empty string', () => {
    expect(keccakHex('')).toBe('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470')
  })

  it('matches the ERC-20 Transfer topic and the transfer selector', () => {
    expect(keccakHex('Transfer(address,address,uint256)')).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef')
    expect(keccakHex('transfer(address,uint256)').slice(0, 10)).toBe('0xa9059cbb')
    expect(keccakHex('balanceOf(address)').slice(0, 10)).toBe('0x70a08231')
  })

  it('handles input longer than one block (136 bytes) and exactly one block', () => {
    // Known keccak256 of 'a'.repeat(200) is not memorised, so check the invariants a bad block loop would break.
    const long = keccakHex('a'.repeat(200))
    expect(long).toMatch(/^0x[0-9a-f]{64}$/)
    expect(long).not.toBe(keccakHex('a'.repeat(199)))
    expect(keccakHex('a'.repeat(136))).not.toBe(keccakHex('a'.repeat(135)))
  })
})
