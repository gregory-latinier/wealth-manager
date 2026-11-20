import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { activeAddresses } from '../sources/smardex/wallets'

const A = '0x806bE92538e21D63EfF9681F5b96dd4f52BFFF31'
const A_LOWER = A.toLowerCase()
const B = '0x1111111111111111111111111111111111111111'

describe('admin smardex wallets', () => {
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
    remoteAddress = `10.30.0.${++client}`
    await query('DELETE FROM "SmardexWallet"')
    await query('DELETE FROM "SmardexPosition"')
    await query('DELETE FROM "SmardexScan"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown, authed = true) =>
    app.inject({ method: 'POST', url: '/api/admin/smardex/wallets', payload: payload as object, cookies: authed ? cookies : {}, remoteAddress })

  it('requires a session on every route', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const calls = [
      { method: 'GET', url: '/api/admin/smardex/wallets' },
      { method: 'POST', url: '/api/admin/smardex/wallets', payload: { label: 'X', address: B } },
      { method: 'PATCH', url: `/api/admin/smardex/wallets/${created.id}`, payload: { active: false } },
      { method: 'DELETE', url: `/api/admin/smardex/wallets/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, res.statusCode]).toEqual([call.method, 401])
    }
    expect((await query('SELECT 1 FROM "SmardexWallet"')).rowCount).toBe(1)
  })

  it('stores the address lowercase and trims the name', async () => {
    const res = await add({ label: '  Main  ', address: ` ${A} ` })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ label: 'Main', address: A_LOWER, active: true })
    expect(await activeAddresses()).toEqual([A_LOWER])
  })

  it.each([
    ['not hex', '0xZZ6bE92538e21D63EfF9681F5b96dd4f52BFFF31'],
    ['too short', '0x806bE92538e21D63EfF9681F5b96dd4f52BFFF'],
    ['no prefix', '806bE92538e21D63EfF9681F5b96dd4f52BFFF31'],
    ['a bitcoin address', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
  ])('rejects an invalid address (%s)', async (_name, address) => {
    const res = await add({ label: 'Main', address })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('Ethereum address')
    expect((await query('SELECT 1 FROM "SmardexWallet"')).rowCount).toBe(0)
  })

  it('rejects a blank name and unknown fields', async () => {
    expect((await add({ label: '   ', address: A })).statusCode).toBe(400)
    expect((await add({ label: 'Main', address: A, chain: 'base' })).statusCode).toBe(400)
  })

  it('refuses the same wallet twice, whatever the casing', async () => {
    expect((await add({ label: 'Main', address: A })).statusCode).toBe(201)
    const again = await add({ label: 'Other', address: A_LOWER })
    expect(again.statusCode).toBe(409)
    expect((await query('SELECT 1 FROM "SmardexWallet"')).rowCount).toBe(1)
  })

  it('lists wallets with their value from the latest snapshot, and null before there is one', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const before = await app.inject({ method: 'GET', url: '/api/admin/smardex/wallets', cookies })
    expect(before.json().wallets[0]).toMatchObject({ id: created.id, lastValue: null })

    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.1, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'smardex', $1, 'wstETH', 1, 100, 100, 90, true), ('l2', 's1', 'smardex', $2, 'wstETH', 1, 100, 50, 45, false)`,
      [`${A_LOWER}:64300:0:0`, `${A_LOWER}:67700:0:0`]
    )
    const after = await app.inject({ method: 'GET', url: '/api/admin/smardex/wallets', cookies })
    expect(after.json().wallets[0].lastValue).toMatchObject({ usd: '150.00000000', date: '2026-11-20', stale: true })
  })

  it('pauses and renames a wallet, and a paused wallet is no longer read', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/smardex/wallets/${created.id}`, payload, cookies, remoteAddress })

    expect((await patch({ active: false })).json()).toMatchObject({ active: false })
    expect(await activeAddresses()).toEqual([])
    expect((await patch({ active: true, label: ' Renamed ' })).json()).toMatchObject({ active: true, label: 'Renamed' })
    expect(await activeAddresses()).toEqual([A_LOWER])
    expect((await patch({ label: '  ' })).statusCode).toBe(400)
    // The address is the wallet's identity, so it cannot be edited.
    expect((await patch({ address: B })).statusCode).toBe(400)
  })

  describe('positions of a wallet', () => {
    const detail = { tick: 64300, tickVersion: '0', index: '0', collateral: '10.000000', error: null }

    it('reads the positions of that wallet through the injected reader', async () => {
      const asked: string[] = []
      const own = await buildApp({
        adminSmardex: {
          positionDetails: async (address) => {
            asked.push(address)
            return { wstEthUsd: '2000.00', positions: [detail as never], warnings: [] }
          },
        },
      })
      await own.ready()
      try {
        const created = (await add({ label: 'Main', address: A })).json()
        const res = await own.inject({ method: 'GET', url: `/api/admin/smardex/wallets/${created.id}/positions`, cookies, remoteAddress })
        expect(res.statusCode).toBe(200)
        expect(res.json()).toMatchObject({ wstEthUsd: '2000.00', positions: [{ tick: 64300, collateral: '10.000000' }], warnings: [] })
        // The address comes from the stored wallet, never from the request.
        expect(asked).toEqual([A_LOWER])
      } finally {
        await own.close()
      }
    })

    it('needs a session and returns 404 for an unknown wallet', async () => {
      const created = (await add({ label: 'Main', address: A })).json()
      expect((await app.inject({ method: 'GET', url: `/api/admin/smardex/wallets/${created.id}/positions` })).statusCode).toBe(401)
      const missing = await app.inject({ method: 'GET', url: '/api/admin/smardex/wallets/nope/positions', cookies, remoteAddress })
      expect(missing.statusCode).toBe(404)
    })
  })

  it('returns 404 for an unknown wallet', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/smardex/wallets/nope', payload: { active: false }, cookies, remoteAddress })
    expect(res.statusCode).toBe(404)
    const del = await app.inject({ method: 'DELETE', url: '/api/admin/smardex/wallets/nope', cookies })
    expect(del.statusCode).toBe(404)
  })

  it('deleting a wallet drops its position cache but keeps snapshot history', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    await query(`INSERT INTO "SmardexPosition" ("address", "tick", "tickVersion", "index") VALUES ($1, 1, '0', '0'), ($2, 2, '0', '0')`, [A_LOWER, B])
    await query(`INSERT INTO "SmardexScan" ("address", "lastTxHash") VALUES ($1, '0xa'), ($2, '0xb')`, [A_LOWER, B])
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 10, 9, 1.1, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'smardex', $1, 'wstETH', 1, 10, 10, 9, false)`,
      [`${A_LOWER}:1:0:0`]
    )

    const res = await app.inject({ method: 'DELETE', url: `/api/admin/smardex/wallets/${created.id}`, cookies })
    expect(res.statusCode).toBe(204)

    // Only this wallet's cache goes. Another wallet's cache and the history stay.
    expect((await query('SELECT "address" FROM "SmardexPosition"')).rows).toEqual([{ address: B }])
    expect((await query('SELECT "address" FROM "SmardexScan"')).rows).toEqual([{ address: B }])
    expect((await query('SELECT 1 FROM "SnapshotLine"')).rowCount).toBe(1)
  })
})
