import { SecretsNotConfiguredError, decryptSecret, encryptSecret, secretsConfigured } from './secrets'

const ORIGINAL = process.env.EXCHANGE_KEY_SECRET

afterEach(() => {
  process.env.EXCHANGE_KEY_SECRET = ORIGINAL
})

describe('secrets', () => {
  it('round-trips text, including unicode and the empty string', () => {
    for (const text of ['hello', '{"apiKey":"k","apiSecret":"s=="}', 'é€🔑', '']) {
      expect(decryptSecret(encryptSecret(text, 'ex1'), 'ex1')).toBe(text)
    }
  })

  it('never stores the plaintext and uses a fresh IV every time', () => {
    const a = encryptSecret('super-secret-value', 'ex1')
    const b = encryptSecret('super-secret-value', 'ex1')
    expect(a).not.toContain('super-secret-value')
    expect(a).not.toBe(b)
    expect(a.split('.')[0]).toBe('v1')
  })

  it('refuses a ciphertext moved to another account', () => {
    const payload = encryptSecret('secret', 'account-a')
    expect(() => decryptSecret(payload, 'account-b')).toThrow('could not be decrypted')
  })

  it('refuses tampered or malformed payloads', () => {
    const [v, iv, tag, data] = encryptSecret('secret', 'ex1').split('.')
    const flipped = Buffer.from(data, 'base64url')
    flipped[0] ^= 1
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64url')].join('.'), 'ex1')).toThrow('could not be decrypted')
    expect(() => decryptSecret('v2.a.b.c', 'ex1')).toThrow('unknown format')
    expect(() => decryptSecret('garbage', 'ex1')).toThrow('unknown format')
    expect(() => decryptSecret([v, iv, tag, data, 'extra'].join('.'), 'ex1')).toThrow('unknown format')
  })

  it('cannot be read with another EXCHANGE_KEY_SECRET', () => {
    const payload = encryptSecret('secret', 'ex1')
    process.env.EXCHANGE_KEY_SECRET = 'another-secret-another-secret-another-secret'
    expect(() => decryptSecret(payload, 'ex1')).toThrow('could not be decrypted')
  })

  it('reports a missing or short EXCHANGE_KEY_SECRET instead of encrypting with a weak key', () => {
    process.env.EXCHANGE_KEY_SECRET = ''
    expect(secretsConfigured()).toBe(false)
    expect(() => encryptSecret('x', 'ex1')).toThrow(SecretsNotConfiguredError)
    process.env.EXCHANGE_KEY_SECRET = 'short'
    expect(() => encryptSecret('x', 'ex1')).toThrow('too short')
  })
})
