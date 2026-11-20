import bcrypt from 'bcryptjs'
import { getPasswordHash } from './config'

const hash = bcrypt.hashSync('a-long-test-password', 4)
const b64 = (s: string) => Buffer.from(s).toString('base64')

describe('getPasswordHash', () => {
  const saved = { plain: process.env.APP_PASSWORD_HASH, encoded: process.env.APP_PASSWORD_HASH_B64 }

  afterEach(() => {
    if (saved.plain === undefined) delete process.env.APP_PASSWORD_HASH
    else process.env.APP_PASSWORD_HASH = saved.plain
    if (saved.encoded === undefined) delete process.env.APP_PASSWORD_HASH_B64
    else process.env.APP_PASSWORD_HASH_B64 = saved.encoded
  })

  const set = (plain?: string, encoded?: string) => {
    if (plain === undefined) delete process.env.APP_PASSWORD_HASH
    else process.env.APP_PASSWORD_HASH = plain
    if (encoded === undefined) delete process.env.APP_PASSWORD_HASH_B64
    else process.env.APP_PASSWORD_HASH_B64 = encoded
  }

  it('reads the plain hash', () => {
    set(hash)
    expect(getPasswordHash()).toBe(hash)
  })

  it('reads the base64 hash, which survives hosts that strip "$"', () => {
    set(undefined, b64(hash))
    expect(getPasswordHash()).toBe(hash)
  })

  it('prefers the base64 value when both are set', () => {
    set('$2b$10$stripped', b64(hash))
    expect(getPasswordHash()).toBe(hash)
  })

  it('rejects a hash whose "$" parts were eaten, and says how long it was without printing it', () => {
    const mangled = hash.replace(/\$2[aby]\$\d{2}/, '')
    set(mangled)
    expect(() => getPasswordHash()).toThrow(/not a valid bcrypt hash \(got 5\d characters/)
    expect(() => getPasswordHash()).toThrow(/APP_PASSWORD_HASH_B64/)
    expect(() => getPasswordHash()).not.toThrow(new RegExp(mangled.slice(0, 20).replace(/[./]/g, '.')))
  })

  it('rejects base64 that does not decode to a hash', () => {
    set(undefined, b64('not a hash'))
    expect(() => getPasswordHash()).toThrow(/APP_PASSWORD_HASH_B64 does not decode/)
  })

  it('fails when nothing is set', () => {
    set()
    expect(() => getPasswordHash()).toThrow(/APP_PASSWORD_HASH is not set/)
  })
})
