import bcrypt from 'bcryptjs'
import { assertConfig, getPasswordHash, verifyPassword } from './config'

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

describe('APP_PASSWORD (plain text)', () => {
  const saved = { plain: process.env.APP_PASSWORD, hash: process.env.APP_PASSWORD_HASH, encoded: process.env.APP_PASSWORD_HASH_B64 }

  afterEach(() => {
    process.env.APP_PASSWORD = saved.plain
    process.env.APP_PASSWORD_HASH = saved.hash
    if (saved.encoded === undefined) delete process.env.APP_PASSWORD_HASH_B64
    else process.env.APP_PASSWORD_HASH_B64 = saved.encoded
  })

  it('accepts the right password and rejects others', async () => {
    process.env.APP_PASSWORD = 'my-plain-password'
    expect(await verifyPassword('my-plain-password')).toBe(true)
    expect(await verifyPassword('my-plain-passwor')).toBe(false)
    expect(await verifyPassword('')).toBe(false)
    expect(await verifyPassword('x'.repeat(200))).toBe(false)
  })

  it('starts without any hash, and wins over a hash a host has mangled', () => {
    process.env.APP_PASSWORD = 'my-plain-password'
    delete process.env.APP_PASSWORD_HASH
    delete process.env.APP_PASSWORD_HASH_B64
    expect(() => assertConfig()).not.toThrow()
    process.env.APP_PASSWORD_HASH = 'mangled'
    expect(() => assertConfig()).not.toThrow()
  })

  it('ignores the hash while APP_PASSWORD is set', async () => {
    process.env.APP_PASSWORD = 'my-plain-password'
    process.env.APP_PASSWORD_HASH = hash
    expect(await verifyPassword('a-long-test-password')).toBe(false)
    expect(await verifyPassword('my-plain-password')).toBe(true)
  })

  it('falls back to the hash when APP_PASSWORD is empty', async () => {
    process.env.APP_PASSWORD = ''
    process.env.APP_PASSWORD_HASH = hash
    expect(await verifyPassword('a-long-test-password')).toBe(true)
  })

  it('refuses a password that is too short', () => {
    process.env.APP_PASSWORD = 'short'
    expect(() => assertConfig()).toThrow(/APP_PASSWORD is too short/)
  })
})
