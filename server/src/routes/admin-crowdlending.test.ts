import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { activeLoans } from '../sources/crowdlending/loans'

describe('admin crowdlending', () => {
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
    remoteAddress = `10.43.0.${++client}`
    await query('DELETE FROM "CrowdlendingLoan"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown) => app.inject({ method: 'POST', url: '/api/admin/crowdlending/loans', payload: payload as object, cookies, remoteAddress })
  const main = { platform: '8lends', name: 'Residence Lyon', lent: '500', dueDate: '2027-03-15' }
  const patchOf = (id: string) => (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/crowdlending/loans/${id}`, payload, cookies, remoteAddress })

  it('requires a session on every route', async () => {
    const created = (await add(main)).json()
    const calls = [
      { method: 'GET', url: '/api/admin/crowdlending/loans' },
      { method: 'POST', url: '/api/admin/crowdlending/loans', payload: main },
      { method: 'PATCH', url: `/api/admin/crowdlending/loans/${created.id}`, payload: { outstanding: '1' } },
      { method: 'DELETE', url: `/api/admin/crowdlending/loans/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, call.url, res.statusCode]).toEqual([call.method, call.url, 401])
    }
    expect((await query('SELECT 1 FROM "CrowdlendingLoan"')).rowCount).toBe(1)
  })

  it('creates a loan with nothing repaid yet, trimming the text and keeping the date as typed', async () => {
    const res = await add({ ...main, platform: ' La Premiere Brique ', name: ' Immeuble Nantes ', lent: '1250.50' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ platform: 'La Premiere Brique', name: 'Immeuble Nantes', lent: '1250.50', outstanding: '1250.50', dueDate: '2027-03-15', active: true })
  })

  it('accepts a loan that is already partly repaid', async () => {
    expect((await add({ ...main, outstanding: '200' })).json()).toMatchObject({ lent: '500.00', outstanding: '200.00' })
  })

  it.each([
    ['a zero amount lent', { lent: '0' }],
    ['an exponent', { lent: '1e3' }],
    ['three decimals', { lent: '10.123' }],
    ['a negative amount', { lent: '-5' }],
    ['more outstanding than lent', { outstanding: '600' }],
    ['a date that does not exist', { dueDate: '2027-02-30' }],
    ['a date in the wrong format', { dueDate: '15/03/2027' }],
    ['a blank platform', { platform: '   ' }],
    ['a blank name', { name: '   ' }],
    ['an unknown field', { currency: 'USD' }],
  ])('rejects %s', async (_name, over) => {
    expect((await add({ ...main, ...over })).statusCode).toBe(400)
    expect((await query('SELECT 1 FROM "CrowdlendingLoan"')).rowCount).toBe(0)
  })

  it('lists loans by refund date, with their value from the latest snapshot', async () => {
    const later = (await add({ ...main, name: 'Later', dueDate: '2028-01-01' })).json()
    const sooner = (await add({ ...main, name: 'Sooner', dueDate: '2027-01-01' })).json()
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'crowdlending', $1, 'EUR', 500, 1.25, 625, 500, false)`,
      [`${sooner.id}:EUR`]
    )
    const res = await app.inject({ method: 'GET', url: '/api/admin/crowdlending/loans', cookies })
    const loans = res.json().loans
    expect(loans.map((l: { id: string }) => l.id)).toEqual([sooner.id, later.id])
    expect(loans[0].lastValue).toMatchObject({ eur: '500.00000000', date: '2026-11-20', stale: false })
    expect(loans[1].lastValue).toBeNull()
  })

  it('records a repayment, moves the date, pauses, and a paused loan is no longer counted', async () => {
    const created = (await add(main)).json()
    const patch = patchOf(created.id)

    expect((await patch({ outstanding: '300' })).json()).toMatchObject({ outstanding: '300.00', lent: '500.00' })
    expect((await patch({ outstanding: '0' })).json()).toMatchObject({ outstanding: '0.00' })
    expect((await patch({ dueDate: '2027-06-01' })).json()).toMatchObject({ dueDate: '2027-06-01' })
    expect((await patch({ name: ' Renamed ', platform: 'Other' })).json()).toMatchObject({ name: 'Renamed', platform: 'Other' })
    expect((await patch({ active: false })).json()).toMatchObject({ active: false })
    expect(await activeLoans()).toEqual([])
    expect((await patch({ active: true })).json()).toMatchObject({ active: true })
    expect(await activeLoans()).toHaveLength(1)
  })

  it('refuses to change the amount lent, an outstanding above it, a bad date and an empty patch', async () => {
    const patch = patchOf((await add(main)).json().id)
    expect((await patch({ lent: '900' })).statusCode).toBe(400)
    expect((await patch({ outstanding: '500.01' })).statusCode).toBe(400)
    expect((await patch({ outstanding: '-1' })).statusCode).toBe(400)
    expect((await patch({ dueDate: '2027-13-01' })).statusCode).toBe(400)
    expect((await patch({ name: ' ' })).statusCode).toBe(400)
    expect((await patch({})).statusCode).toBe(400)
  })

  it('answers 404 for an unknown loan', async () => {
    expect((await patchOf('nope')({ outstanding: '1' })).statusCode).toBe(404)
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/crowdlending/loans/nope', cookies, remoteAddress })
    expect(del.statusCode).toBe(404)
  })

  it('deletes a loan and leaves snapshot history alone', async () => {
    const created = (await add(main)).json()
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.25, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'crowdlending', $1, 'EUR', 500, 1.25, 625, 500, false)`,
      [`${created.id}:EUR`]
    )
    const res = await app.inject({ method: 'DELETE', url: `/api/admin/crowdlending/loans/${created.id}`, cookies, remoteAddress })
    expect(res.statusCode).toBe(204)
    expect((await query('SELECT 1 FROM "CrowdlendingLoan"')).rowCount).toBe(0)
    expect((await query('SELECT 1 FROM "SnapshotLine"')).rowCount).toBe(1)
  })
})
