import './env'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

/**
 * A bcrypt hash contains "$", and some hosting panels run the value through a shell that eats "$2b" and "$10".
 * APP_PASSWORD_HASH_B64 carries the same hash base64-encoded (no "$"), so nothing can alter it. It wins when set.
 */
export function getPasswordHash(): string {
  const encoded = process.env.APP_PASSWORD_HASH_B64?.trim()
  const hash = encoded ? Buffer.from(encoded, 'base64').toString('utf8').trim() : process.env.APP_PASSWORD_HASH?.trim()
  if (!hash) {
    throw new Error(
      'APP_PASSWORD_HASH is not set. Set APP_PASSWORD to your password, or generate a hash with `pnpm hash-password` and set APP_PASSWORD_HASH_B64 (or APP_PASSWORD_HASH).'
    )
  }
  if (!BCRYPT_HASH.test(hash)) {
    const source = encoded ? 'APP_PASSWORD_HASH_B64 does not decode to' : 'APP_PASSWORD_HASH is not'
    // Show the shape, never the value: the log must not hold anything usable.
    throw new Error(
      `${source} a valid bcrypt hash (got ${hash.length} characters, expected 60 starting with "$2"). ` +
        'If your host strips "$" from environment variables, use APP_PASSWORD_HASH_B64 instead. In a .env file wrap APP_PASSWORD_HASH in single quotes.'
    )
  }
  return hash
}

const MIN_PASSWORD_LENGTH = 8

/**
 * The simplest setup: the password itself in the environment. Fine for a single-owner app whose host already
 * keeps its environment private. It wins over any hash, so a hash a host has mangled cannot block startup.
 */
export function getPlainPassword(): string | undefined {
  const password = process.env.APP_PASSWORD
  if (!password) return undefined
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`APP_PASSWORD is too short (minimum ${MIN_PASSWORD_LENGTH} characters).`)
  }
  return password
}

/** Compares SHA-256 digests, so the comparison is constant-time whatever the lengths. */
function samePassword(candidate: string, expected: string): boolean {
  const digest = (value: string) => crypto.createHash('sha256').update(value).digest()
  return crypto.timingSafeEqual(digest(candidate), digest(expected))
}

export async function verifyPassword(candidate: string): Promise<boolean> {
  const plain = getPlainPassword()
  if (plain !== undefined) return samePassword(candidate, plain)
  return bcrypt.compare(candidate, getPasswordHash())
}

const MIN_TOKEN_LENGTH = 32

export function getSnapshotToken(): string {
  const token = process.env.SNAPSHOT_TOKEN?.trim()
  if (!token) {
    throw new Error('SNAPSHOT_TOKEN is not set. Generate one with `openssl rand -hex 32` and set it in the environment.')
  }
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`SNAPSHOT_TOKEN is too short (minimum ${MIN_TOKEN_LENGTH} characters). Use \`openssl rand -hex 32\`.`)
  }
  return token
}

/** Fails fast at startup so a misconfigured deployment never serves a login or a cron endpoint it cannot check. */
export function assertConfig(): void {
  if (getPlainPassword() === undefined) getPasswordHash()
  getSnapshotToken()
}
