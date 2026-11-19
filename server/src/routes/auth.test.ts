import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { requireAuth, SESSION_COOKIE } from '../lib/auth'
import { assertConfig } from '../lib/config'

const PASSWORD = 'correct-horse-battery'

function sessionCookieFrom(res: { cookies: Array<{ name: string; value: string }> }): string | undefined {
  return res.cookies.find((c) => c.name === SESSION_COOKIE)?.value
}

async function login(app: FastifyInstance, remoteAddress?: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: PASSWORD }, remoteAddress })
}

describe('auth', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp()
    // A protected route to exercise requireAuth.
    app.get('/api/_protected', { preHandler: requireAuth }, async () => ({ ok: true }))
    await app.ready()
  })

  beforeEach(async () => {
    await query('DELETE FROM "Session"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  it('logs in with the right password and sets an httpOnly cookie', async () => {
    const res = await login(app)
    expect(res.statusCode).toBe(200)
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)
    expect(cookie).toBeDefined()
    expect(cookie!.httpOnly).toBe(true)
    expect(cookie!.sameSite).toBe('Lax')
  })

  it('stores only a hash of the session token', async () => {
    const res = await login(app)
    const token = sessionCookieFrom(res)!
    const rows = await query('SELECT "tokenHash" FROM "Session"')
    expect(rows.rowCount).toBe(1)
    expect(rows.rows[0].tokenHash).not.toBe(token)
    expect(rows.rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects a wrong password without creating a session', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'nope' } })
    expect(res.statusCode).toBe(401)
    expect(sessionCookieFrom(res)).toBeUndefined()
    expect((await query('SELECT 1 FROM "Session"')).rowCount).toBe(0)
  })

  it('rejects a missing or oversized password with 400', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/auth/login', payload: {} })
    expect(missing.statusCode).toBe(400)
    const huge = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'x'.repeat(5000) } })
    expect(huge.statusCode).toBe(400)
  })

  it('/me reports the session state', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/auth/me' })
    expect(anonymous.statusCode).toBe(401)

    const token = sessionCookieFrom(await login(app))!
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
    expect(me.statusCode).toBe(200)
    expect(me.json()).toEqual({ authenticated: true })
  })

  it('requireAuth blocks anonymous requests and lets a session through', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/_protected' })).statusCode).toBe(401)

    const token = sessionCookieFrom(await login(app))!
    const ok = await app.inject({ method: 'GET', url: '/api/_protected', cookies: { [SESSION_COOKIE]: token } })
    expect(ok.statusCode).toBe(200)
  })

  it('rejects an expired session', async () => {
    const token = sessionCookieFrom(await login(app))!
    await query(`UPDATE "Session" SET "expiresAt" = NOW() - INTERVAL '1 minute'`)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
    expect(res.statusCode).toBe(401)
  })

  it('slides the expiry forward when the session is more than a day old', async () => {
    const token = sessionCookieFrom(await login(app))!
    await query(`UPDATE "Session" SET "expiresAt" = NOW() + INTERVAL '5 days'`)
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
    expect(res.statusCode).toBe(200)
    expect(sessionCookieFrom(res)).toBe(token)
    const row = await query(`SELECT "expiresAt" > NOW() + INTERVAL '20 days' AS renewed FROM "Session"`)
    expect(row.rows[0].renewed).toBe(true)
  })

  it('logout deletes the session so the cookie stops working', async () => {
    const token = sessionCookieFrom(await login(app))!
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', cookies: { [SESSION_COOKIE]: token } })
    expect(out.statusCode).toBe(200)
    expect((await query('SELECT 1 FROM "Session"')).rowCount).toBe(0)

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', cookies: { [SESSION_COOKIE]: token } })
    expect(me.statusCode).toBe(401)
  })

  it('rate limits login after 10 failed attempts from one IP, and not other IPs', async () => {
    const attempt = (ip: string) =>
      app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'wrong' }, remoteAddress: ip })

    for (let i = 0; i < 10; i++) {
      expect((await attempt('10.9.9.9')).statusCode).toBe(401)
    }
    expect((await attempt('10.9.9.9')).statusCode).toBe(429)
    // another client is unaffected
    expect((await login(app, '10.8.8.8')).statusCode).toBe(200)
  })
})

describe('assertConfig', () => {
  const original = process.env.APP_PASSWORD_HASH
  afterEach(() => {
    process.env.APP_PASSWORD_HASH = original
  })

  it('refuses to start without APP_PASSWORD_HASH', () => {
    delete process.env.APP_PASSWORD_HASH
    expect(() => assertConfig()).toThrow(/APP_PASSWORD_HASH is not set/)
  })

  it('refuses to start without a long enough SNAPSHOT_TOKEN', () => {
    const token = process.env.SNAPSHOT_TOKEN
    try {
      delete process.env.SNAPSHOT_TOKEN
      expect(() => assertConfig()).toThrow(/SNAPSHOT_TOKEN is not set/)
      process.env.SNAPSHOT_TOKEN = 'short'
      expect(() => assertConfig()).toThrow(/too short/)
    } finally {
      process.env.SNAPSHOT_TOKEN = token
    }
  })

  it('refuses a value that is not a bcrypt hash (e.g. a .env value mangled by "$" expansion)', () => {
    process.env.APP_PASSWORD_HASH = 'plain-text-password'
    expect(() => assertConfig()).toThrow(/not a valid bcrypt hash/)
  })
})
