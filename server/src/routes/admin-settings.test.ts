import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { SECTIONS } from '../lib/settings'

describe('admin settings', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let client = 0
  let remoteAddress = ''

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  beforeEach(async () => {
    remoteAddress = `10.45.0.${++client}`
    await query(`DELETE FROM "Setting" WHERE "key" = 'ui.hiddenSections'`)
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const get = () => app.inject({ method: 'GET', url: '/api/admin/settings', cookies, remoteAddress })
  const patch = (payload: unknown) => app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: payload as object, cookies, remoteAddress })

  it('requires a session', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/settings' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/settings', payload: { hiddenSections: [] } })).statusCode).toBe(401)
  })

  it('lists every section and hides none by default', async () => {
    expect((await get()).json()).toEqual({ sections: [...SECTIONS], hiddenSections: [] })
  })

  it('hides sections, keeps them in menu order, and remembers them', async () => {
    const res = await patch({ hiddenSections: ['mt5', 'bank', 'crypto'] })
    expect(res.statusCode).toBe(200)
    expect(res.json().hiddenSections).toEqual(['crypto', 'bank', 'mt5'])
    expect((await get()).json().hiddenSections).toEqual(['crypto', 'bank', 'mt5'])
  })

  it('shows everything again with an empty list', async () => {
    await patch({ hiddenSections: ['bank'] })
    expect((await patch({ hiddenSections: [] })).json().hiddenSections).toEqual([])
  })

  it('refuses an unknown section, a duplicate, an empty body and extra fields', async () => {
    expect((await patch({ hiddenSections: ['nope'] })).statusCode).toBe(400)
    expect((await patch({ hiddenSections: ['bank', 'bank'] })).statusCode).toBe(400)
    expect((await patch({ hiddenSections: ['dashboard'] })).statusCode).toBe(400)
    expect((await patch({})).statusCode).toBe(400)
    expect((await patch({ hiddenSections: [], other: 1 })).statusCode).toBe(400)
  })

  it('ignores a hand-edited stored value instead of breaking the menu', async () => {
    await query(`INSERT INTO "Setting" ("key", "value") VALUES ('ui.hiddenSections', 'not json') ON CONFLICT ("key") DO UPDATE SET "value" = 'not json'`)
    expect((await get()).json().hiddenSections).toEqual([])
    await query(`UPDATE "Setting" SET "value" = '["bank","gone"]' WHERE "key" = 'ui.hiddenSections'`)
    expect((await get()).json().hiddenSections).toEqual(['bank'])
  })
})
