import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import type { FxProvider } from '../sources/fx/frankfurter'
import type { SourceType } from '../sources/types'

const TOKEN = process.env.SNAPSHOT_TOKEN!
const bearer = (token: string) => ({ authorization: `Bearer ${token}` })

const fxOk: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }
const fxDown: FxProvider = {
  getUsdPerEur: async () => {
    throw new Error('frankfurter down')
  },
}

const fakeSource: SourceType = {
  id: 'fake',
  collect: async () => ({
    lines: [{ sourceRef: 'a', symbol: 'USD', amount: dec('1000'), priceUsd: dec('1') }],
    failures: [{ sourceRef: 'never-seen', reason: 'no price' }],
  }),
}

async function appWith(fx: FxProvider): Promise<FastifyInstance> {
  const app = await buildApp({ snapshots: { fx, sources: () => [fakeSource] } })
  await app.ready()
  return app
}

describe('POST /api/snapshots/run', () => {
  beforeEach(async () => {
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
    await query('DELETE FROM "Session"')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('rejects a missing or wrong token with 401 and writes nothing (SC2)', async () => {
    const app = await appWith(fxOk)
    const none = await app.inject({ method: 'POST', url: '/api/snapshots/run' })
    const wrong = await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: bearer('wrong') })
    const longer = await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: bearer(TOKEN + 'x') })
    const basic = await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: { authorization: `Basic ${TOKEN}` } })

    expect([none, wrong, longer, basic].map((r) => r.statusCode)).toEqual([401, 401, 401, 401])
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(0)
    await app.close()
  })

  it('does not accept a session cookie alone (SC2)', async () => {
    const app = await appWith(fxOk)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    const cookie = login.cookies.find((c) => c.name === SESSION_COOKIE)!.value

    const res = await app.inject({ method: 'POST', url: '/api/snapshots/run', cookies: { [SESSION_COOKIE]: cookie } })
    expect(res.statusCode).toBe(401)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(0)
    await app.close()
  })

  it('takes a snapshot with a valid token and returns the summary', async () => {
    const app = await appWith(fxOk)
    const res = await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: bearer(TOKEN) })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({
      status: 'partial', // one entry had no history, so it was left out
      totalUsd: '1000.00000000',
      totalEur: '800.00000000',
      lineCount: 1,
      stale: [],
      leftOut: [{ sourceType: 'fake', sourceRef: 'never-seen', reason: 'no price' }],
    })
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(1)
    await app.close()
  })

  it('is idempotent within a day: calling twice leaves one snapshot', async () => {
    const app = await appWith(fxOk)
    await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: bearer(TOKEN) })
    const second = await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: bearer(TOKEN) })
    expect(second.statusCode).toBe(200)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(1)
    await app.close()
  })

  it('returns 503 and writes nothing when the rate fails and none was ever stored (SC9)', async () => {
    const app = await appWith(fxDown)
    const res = await app.inject({ method: 'POST', url: '/api/snapshots/run', headers: bearer(TOKEN) })
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toMatch(/No USD\/EUR rate/)
    expect((await query('SELECT 1 FROM "Snapshot"')).rowCount).toBe(0)
    await app.close()
  })
})
