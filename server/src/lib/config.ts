import './env'

const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/

export function getPasswordHash(): string {
  const hash = process.env.APP_PASSWORD_HASH?.trim()
  if (!hash) {
    throw new Error('APP_PASSWORD_HASH is not set. Generate one with `pnpm hash-password` and set it in the environment.')
  }
  if (!BCRYPT_HASH.test(hash)) {
    throw new Error(
      'APP_PASSWORD_HASH is not a valid bcrypt hash. In a .env file wrap it in single quotes, because it contains "$".'
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
