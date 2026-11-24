import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { deleteSetting } from '../lib/settings'

const SETTING_KEYS = ['gomining.thPrice', 'gomining.thCurrency', 'gomining.btc', 'gomining.gmt']

describe('admin gomining', () => {
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
    remoteAddress = `10.46.0.${++client}`
    await query('DELETE FROM "GominingMiner"')
    for (const key of SETTING_KEYS) await deleteSetting(key)
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const overview = async () => (await app.inject({ method: 'GET', url: '/api/admin/gomining/', cookies, remoteAddress })).json()
  const addMiner = (payload: unknown) => app.inject({ method: 'POST', url: '/api/admin/gomining/miners', payload: payload as object, cookies, remoteAddress })
  const patchMiner = (id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/gomining/miners/${id}`, payload, cookies, remoteAddress })
  const saveSettings = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/admin/gomining/settings', payload: payload as object, cookies, remoteAddress })

  it('requires a session on every route', async () => {
    const calls = [
      { method: 'GET', url: '/api/admin/gomining/' },
      { method: 'PUT', url: '/api/admin/gomining/settings', payload: { btc: '1' } },
      { method: 'POST', url: '/api/admin/gomining/miners', payload: { name: 'a', th: '1' } },
      { method: 'PATCH', url: '/api/admin/gomining/miners/x', payload: { active: false } },
      { method: 'DELETE', url: '/api/admin/gomining/miners/x' },
    ] as const
    for (const [i, call] of calls.entries()) {
      const res = await app.inject({ ...call, remoteAddress: `10.46.1.${i + 1}` })
      expect(res.statusCode).toBe(401)
    }
  })

  it('starts empty, with nothing set', async () => {
    expect(await overview()).toMatchObject({ miners: [], settings: { thPrice: null, thCurrency: 'EUR', btc: '0', gmt: '0' }, wallet: { btc: null, gmt: null } })
  })

  it('adds, edits, pauses and deletes a miner', async () => {
    const created = await addMiner({ name: '  Main  ', th: '12.5' })
    expect(created.statusCode).toBe(201)
    const { id } = created.json()
    expect(created.json()).toMatchObject({ name: 'Main', th: '12.5000', active: true })

    expect((await patchMiner(id, { th: '15' })).json()).toMatchObject({ th: '15.0000' })
    expect((await patchMiner(id, { active: false })).json()).toMatchObject({ active: false, name: 'Main' })
    expect((await overview()).miners).toHaveLength(1)

    expect((await app.inject({ method: 'DELETE', url: `/api/admin/gomining/miners/${id}`, cookies, remoteAddress })).statusCode).toBe(204)
    expect((await overview()).miners).toEqual([])
  })

  it.each([['0'], ['-1'], ['1e3'], ['abc'], ['1.23456'], ['']])('rejects %p as a TH', async (th) => {
    expect((await addMiner({ name: 'a', th })).statusCode).toBe(400)
  })

  it('rejects a blank name and unknown fields', async () => {
    expect((await addMiner({ name: '   ', th: '1' })).statusCode).toBe(400)
    expect((await addMiner({ name: 'a', th: '1', extra: 1 })).statusCode).toBe(400)
  })

  it('answers 404 for a miner that does not exist', async () => {
    expect((await patchMiner('nope', { active: false })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/gomining/miners/nope', cookies, remoteAddress })).statusCode).toBe(404)
  })

  it('stores the value per TH and the wallet, and changes only what is sent', async () => {
    const res = await saveSettings({ thPrice: '19.5', thCurrency: 'USD', btc: '0.00012345', gmt: '1500' })
    expect(res.json()).toEqual({ thPrice: '19.5', thCurrency: 'USD', btc: '0.00012345', gmt: '1500' })
    expect((await saveSettings({ btc: '2' })).json()).toEqual({ thPrice: '19.5', thCurrency: 'USD', btc: '2', gmt: '1500' })
  })

  it('forgets the price and empties a balance when sent empty', async () => {
    await saveSettings({ thPrice: '20', btc: '1', gmt: '5' })
    expect((await saveSettings({ thPrice: '', btc: '', gmt: '' })).json()).toMatchObject({ thPrice: null, btc: '0', gmt: '0' })
  })

  it.each([
    [{ thPrice: '-1' }],
    [{ thPrice: '1.23456' }],
    [{ btc: '0.123456789' }],
    [{ btc: '1e2' }],
    [{ gmt: 'many' }],
    [{ thCurrency: 'GBP' }],
    [{}],
    [{ thPrice: '1', extra: true }],
  ])('rejects the settings %p', async (payload) => {
    expect((await saveSettings(payload)).statusCode).toBe(400)
  })

  it('shows what each line was worth in the latest snapshot', async () => {
    const { id } = (await addMiner({ name: 'Main', th: '10' })).json()
    await query(`INSERT INTO "Snapshot" ("id","date","totalUsd","totalEur","usdPerEur","status") VALUES ('s1','2026-11-20',100,80,1.25,'complete')`)
    const line = (lineId: string, ref: string, symbol: string, usd: number, stale: boolean) =>
      query(
        `INSERT INTO "SnapshotLine" ("id","snapshotId","sourceType","sourceRef","symbol","amount","priceUsd","valueUsd","valueEur","stale") VALUES ($1,'s1','gomining',$2,$3,1,1,$4,$5,$6)`,
        [lineId, ref, symbol, usd, usd / 1.25, stale]
      )
    await line('l1', `${id}:TH`, 'TH', 200, false)
    await line('l2', 'wallet:BTC', 'BTC', 50, true)

    const res = await overview()
    expect(res.miners[0].lastValue).toMatchObject({ date: '2026-11-20', stale: false })
    expect(Number(res.miners[0].lastValue.usd)).toBe(200)
    expect(res.wallet.btc).toMatchObject({ stale: true })
    expect(res.wallet.gmt).toBeNull()
  })
})
