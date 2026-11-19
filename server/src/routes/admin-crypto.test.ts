import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { runSnapshot } from '../lib/snapshot'
import type { FxProvider } from '../sources/fx/frankfurter'

const EVM = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01'
const LEGACY = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
const BECH32 = 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'

describe('admin crypto addresses', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>

  beforeAll(async () => {
    app = await buildApp()
    await app.ready()
  })

  beforeEach(async () => {
    await query('DELETE FROM "CryptoAddress"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown, authed = true) =>
    app.inject({ method: 'POST', url: '/api/admin/crypto/addresses', payload: payload as object, cookies: authed ? cookies : {} })

  it('requires a session on every route (SC1)', async () => {
    const created = (await add({ chain: 'eth', address: EVM })).json()
    const calls = [
      { method: 'GET', url: '/api/admin/crypto/addresses' },
      { method: 'POST', url: '/api/admin/crypto/addresses', payload: { chain: 'eth', address: EVM } },
      { method: 'PATCH', url: `/api/admin/crypto/addresses/${created.id}`, payload: { active: false } },
      { method: 'DELETE', url: `/api/admin/crypto/addresses/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, res.statusCode]).toEqual([call.method, 401])
    }
    expect((await query('SELECT 1 FROM "CryptoAddress"')).rowCount).toBe(1) // nothing changed
  })

  it('stores valid BTC, ETH and Base addresses, lowercasing EVM (SC3)', async () => {
    const eth = await add({ chain: 'eth', address: EVM, label: '  Main  ' })
    expect(eth.statusCode).toBe(201)
    expect(eth.json()).toMatchObject({ chain: 'eth', address: EVM.toLowerCase(), label: 'Main', active: true })

    expect((await add({ chain: 'base', address: EVM })).statusCode).toBe(201) // same address, other chain
    expect((await add({ chain: 'btc', address: LEGACY })).statusCode).toBe(201)
    expect((await add({ chain: 'btc', address: BECH32 })).statusCode).toBe(201)

    const list = (await app.inject({ method: 'GET', url: '/api/admin/crypto/addresses', cookies })).json()
    expect(list.addresses).toHaveLength(4)
  })

  it('creates the native asset row with the right symbol and decimals', async () => {
    await add({ chain: 'btc', address: LEGACY })
    await add({ chain: 'base', address: EVM })
    const rows = await query(
      `SELECT a."chain", s."kind", s."symbol", s."decimals" FROM "CryptoAsset" s JOIN "CryptoAddress" a ON a."id" = s."addressId" ORDER BY a."chain"`
    )
    expect(rows.rows).toEqual([
      { chain: 'base', kind: 'native', symbol: 'ETH', decimals: 18 },
      { chain: 'btc', kind: 'native', symbol: 'BTC', decimals: 8 },
    ])
  })

  it('rejects malformed input with 400 and stores nothing', async () => {
    const bad = [
      { chain: 'eth', address: '0x123' },
      { chain: 'btc', address: EVM },
      { chain: 'doge', address: LEGACY },
      { chain: 'eth' },
      { chain: 'eth', address: EVM, label: 'x'.repeat(101) },
      { chain: 'eth', address: EVM, extra: 'field' },
    ]
    for (const payload of bad) {
      expect([JSON.stringify(payload), (await add(payload)).statusCode]).toEqual([JSON.stringify(payload), 400])
    }
    expect((await query('SELECT 1 FROM "CryptoAddress"')).rowCount).toBe(0)
  })

  it('returns 409 for a duplicate (chain, address), including a different EVM casing', async () => {
    expect((await add({ chain: 'eth', address: EVM })).statusCode).toBe(201)
    expect((await add({ chain: 'eth', address: EVM.toLowerCase() })).statusCode).toBe(409)
    expect((await query('SELECT 1 FROM "CryptoAddress"')).rowCount).toBe(1)
    expect((await query('SELECT 1 FROM "CryptoAsset"')).rowCount).toBe(1) // no orphan native row
  })

  it('edits the label and pauses and resumes an address', async () => {
    const { id } = (await add({ chain: 'eth', address: EVM })).json()
    const patch = (payload: object) =>
      app.inject({ method: 'PATCH', url: `/api/admin/crypto/addresses/${id}`, payload, cookies })

    expect((await patch({ label: 'Cold' })).json()).toMatchObject({ label: 'Cold', active: true })
    expect((await patch({ active: false })).json()).toMatchObject({ label: 'Cold', active: false })
    expect((await patch({ label: null, active: true })).json()).toMatchObject({ label: null, active: true })
    expect((await patch({})).statusCode).toBe(400)
    expect((await patch({ chain: 'btc' })).statusCode).toBe(400) // chain and address are immutable
    expect(
      (await app.inject({ method: 'PATCH', url: '/api/admin/crypto/addresses/nope', payload: { active: false }, cookies })).statusCode
    ).toBe(404)
  })

  it('delete removes the address and its assets, 404 afterwards', async () => {
    const { id } = (await add({ chain: 'eth', address: EVM })).json()
    const del = () => app.inject({ method: 'DELETE', url: `/api/admin/crypto/addresses/${id}`, cookies })

    expect((await del()).statusCode).toBe(204)
    expect((await del()).statusCode).toBe(404)
    expect((await query('SELECT 1 FROM "CryptoAddress"')).rowCount).toBe(0)
    expect((await query('SELECT 1 FROM "CryptoAsset"')).rowCount).toBe(0)
  })

  it('pausing or deleting an address never touches snapshot lines (SC6)', async () => {
    const { id } = (await add({ chain: 'eth', address: EVM })).json()
    const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }
    await runSnapshot({
      sources: [
        {
          id: 'crypto',
          collect: async () => ({
            lines: [{ sourceRef: `eth:${EVM.toLowerCase()}:native`, symbol: 'ETH', amount: dec('2'), priceUsd: dec('2500') }],
            failures: [],
          }),
        },
      ],
      fx,
      now: new Date('2026-11-19T12:00:00Z'),
    })
    const before = (await query('SELECT * FROM "SnapshotLine" ORDER BY "id"')).rows
    expect(before).toHaveLength(1)

    await app.inject({ method: 'PATCH', url: `/api/admin/crypto/addresses/${id}`, payload: { active: false }, cookies })
    await app.inject({ method: 'DELETE', url: `/api/admin/crypto/addresses/${id}`, cookies })

    expect((await query('SELECT * FROM "SnapshotLine" ORDER BY "id"')).rows).toEqual(before)
  })
})
