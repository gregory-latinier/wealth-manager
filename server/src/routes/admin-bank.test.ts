import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { activeAccounts } from '../sources/bank/accounts'

describe('admin bank accounts', () => {
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
    remoteAddress = `10.41.0.${++client}`
    await query('DELETE FROM "BankAccount"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown) => app.inject({ method: 'POST', url: '/api/admin/bank/accounts', payload: payload as object, cookies, remoteAddress })
  const main = { name: 'Checking', bank: 'Boursorama', currency: 'EUR', balance: '1250.50' }

  const insertSnapshotLine = async (ref: string, symbol: string, amount: number, priceUsd: number, valueUsd: number, valueEur: number) => {
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'bank', $1, $2, $3, $4, $5, $6, false)`,
      [ref, symbol, amount, priceUsd, valueUsd, valueEur]
    )
  }

  it('requires a session on every route', async () => {
    const created = (await add(main)).json()
    const calls = [
      { method: 'GET', url: '/api/admin/bank/accounts' },
      { method: 'POST', url: '/api/admin/bank/accounts', payload: main },
      { method: 'PATCH', url: `/api/admin/bank/accounts/${created.id}`, payload: { balance: '1' } },
      { method: 'DELETE', url: `/api/admin/bank/accounts/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, call.url, res.statusCode]).toEqual([call.method, call.url, 401])
    }
    expect((await query('SELECT 1 FROM "BankAccount"')).rowCount).toBe(1)
  })

  it('creates an account, trimming the text and keeping the balance exact', async () => {
    const res = await add({ ...main, name: '  Checking  ', bank: ' Boursorama ' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ name: 'Checking', bank: 'Boursorama', currency: 'EUR', balance: '1250.50', active: true })
    expect(res.json().id).toMatch(/^ba[0-9a-f]+$/)
  })

  it('accepts an overdraft, an empty balance and no bank name', async () => {
    expect((await add({ name: 'Card', currency: 'USD', balance: '-80.5' })).json()).toMatchObject({ balance: '-80.50', bank: '' })
    expect((await add({ name: 'Empty', currency: 'USD', balance: '0' })).statusCode).toBe(201)
  })

  it.each([
    ['an exponent', '1e3'],
    ['three decimals', '1.234'],
    ['a thousands separator', '1,250.50'],
    ['text', 'abc'],
    ['a plus sign', '+5'],
  ])('rejects a balance with %s', async (_name, balance) => {
    expect((await add({ ...main, balance })).statusCode).toBe(400)
    expect((await query('SELECT 1 FROM "BankAccount"')).rowCount).toBe(0)
  })

  it('rejects an unsupported currency, a blank name and unknown fields', async () => {
    expect((await add({ ...main, currency: 'GBP' })).statusCode).toBe(400)
    expect((await add({ ...main, name: '   ' })).statusCode).toBe(400)
    expect((await add({ ...main, iban: 'FR76' })).statusCode).toBe(400)
  })

  it('lists accounts with their value from the latest snapshot', async () => {
    const created = (await add(main)).json()
    const before = await app.inject({ method: 'GET', url: '/api/admin/bank/accounts', cookies })
    expect(before.json().accounts[0]).toMatchObject({ id: created.id, lastValue: null })

    await insertSnapshotLine(`${created.id}:EUR`, 'EUR', 1250.5, 1.25, 1563.125, 1250.5)
    const after = await app.inject({ method: 'GET', url: '/api/admin/bank/accounts', cookies })
    expect(after.json().accounts[0].lastValue).toMatchObject({ eur: '1250.50000000', date: '2026-11-20', stale: false })
  })

  it('updates the balance, renames and pauses, and a paused account is no longer counted', async () => {
    const created = (await add(main)).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/bank/accounts/${created.id}`, payload, cookies, remoteAddress })

    expect((await patch({ balance: '900' })).json()).toMatchObject({ balance: '900.00' })
    expect((await patch({ name: ' Joint ', bank: 'N26' })).json()).toMatchObject({ name: 'Joint', bank: 'N26' })
    expect((await patch({ active: false })).json()).toMatchObject({ active: false })
    expect(await activeAccounts()).toEqual([])
    expect((await patch({ active: true })).json()).toMatchObject({ active: true })
    expect(await activeAccounts()).toHaveLength(1)
  })

  it('refuses to change the currency, a bad balance, a blank name and an empty patch', async () => {
    const created = (await add(main)).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/bank/accounts/${created.id}`, payload, cookies, remoteAddress })
    expect((await patch({ currency: 'USD' })).statusCode).toBe(400)
    expect((await patch({ balance: '1.234' })).statusCode).toBe(400)
    expect((await patch({ name: '  ' })).statusCode).toBe(400)
    expect((await patch({})).statusCode).toBe(400)
  })

  it('answers 404 for an unknown account', async () => {
    const patch = await app.inject({ method: 'PATCH', url: '/api/admin/bank/accounts/nope', payload: { balance: '1' }, cookies, remoteAddress })
    expect(patch.statusCode).toBe(404)
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/bank/accounts/nope', cookies, remoteAddress })
    expect(del.statusCode).toBe(404)
  })

  it('deletes an account and leaves snapshot history alone', async () => {
    const created = (await add(main)).json()
    await insertSnapshotLine(`${created.id}:EUR`, 'EUR', 10, 1.25, 12.5, 10)
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/bank/accounts/${created.id}`, cookies, remoteAddress })
    expect(res.statusCode).toBe(204)
    expect((await query('SELECT 1 FROM "BankAccount"')).rowCount).toBe(0)
    expect((await query('SELECT 1 FROM "SnapshotLine"')).rowCount).toBe(1)
  })
})
