import './env'

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
      'APP_PASSWORD_HASH is not set. Generate one with `pnpm hash-password` and set APP_PASSWORD_HASH_B64 (or APP_PASSWORD_HASH) in the environment.'
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
  getPasswordHash()
  getSnapshotToken()
}
