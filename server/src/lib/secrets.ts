import crypto from 'crypto'
import './env'

const MIN_SECRET_LENGTH = 32
const VERSION = 'v1'

/** EXCHANGE_KEY_SECRET is missing or too short. Exchange features report this instead of storing anything unprotected. */
export class SecretsNotConfiguredError extends Error {
  constructor(why: string) {
    super(`${why} Generate one with \`openssl rand -hex 32\` and set EXCHANGE_KEY_SECRET.`)
    this.name = 'SecretsNotConfiguredError'
  }
}

function getKey(): Buffer {
  const secret = process.env.EXCHANGE_KEY_SECRET?.trim()
  if (!secret) throw new SecretsNotConfiguredError('EXCHANGE_KEY_SECRET is not set.')
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new SecretsNotConfiguredError(`EXCHANGE_KEY_SECRET is too short (minimum ${MIN_SECRET_LENGTH} characters).`)
  }
  // HKDF turns the passphrase into a 256-bit key, so the env value can be any text of enough length.
  return Buffer.from(crypto.hkdfSync('sha256', secret, 'wealth-manager-exchange-v1', 'aes-256-gcm', 32))
}

export function secretsConfigured(): boolean {
  try {
    getKey()
    return true
  } catch {
    return false
  }
}

/**
 * AES-256-GCM. `context` (the account id) is authenticated but not stored in the payload, so a ciphertext copied
 * onto another row fails to decrypt instead of silently trading accounts.
 * Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
export function encryptSecret(plaintext: string, context: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv)
  cipher.setAAD(Buffer.from(context, 'utf8'))
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

export function decryptSecret(payload: string, context: string): string {
  const [version, iv, tag, data, ...extra] = payload.split('.')
  if (version !== VERSION || !iv || !tag || data === undefined || extra.length > 0) throw new Error('Stored secret has an unknown format')
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(context, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
  } catch (err) {
    if (err instanceof SecretsNotConfiguredError) throw err
    // Wrong EXCHANGE_KEY_SECRET, edited ciphertext or a different row: all look the same on purpose.
    throw new Error('Stored secret could not be decrypted (was EXCHANGE_KEY_SECRET changed?)')
  }
}
