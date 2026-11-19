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

/** Fails fast at startup so a misconfigured deployment never serves a login it cannot check. */
export function assertConfig(): void {
  getPasswordHash()
}
