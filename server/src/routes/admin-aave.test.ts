import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import { keccakHex } from '../lib/keccak'
import { debtRef, supplyRef } from '../sources/aave'
import { activeAddresses, lastRefs } from '../sources/aave/wallets'
import type { CallOutcome } from '../sources/crypto/providers/evm-rpc'

const A = '0x806bE92538e21D63EfF9681F5b96dd4f52BFFF31'
const A_LOWER = A.toLowerCase()
const B = '0x1111111111111111111111111111111111111111'
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'

const sel = (sig: string) => keccakHex(sig).slice(0, 10)
const word = (value: bigint) => value.toString(16).padStart(64, '0')

/** A Spoke with two reserves: 0 is 3.5 WETH supplied, 1 is 4300 USDC owed. */
const ethCall = async (calls: Array<{ to: string; data: string }>): Promise<CallOutcome[]> =>
  calls.map((c): CallOutcome => {
    const selector = c.data.slice(0, 10)
    const id = Number(BigInt('0x' + (c.data.slice(10, 74) || '0')))
    if (selector === sel('getReserveCount()')) return { ok: true, result: '0x' + word(2n) }
    if (selector === sel('getUserAccountData(address)')) return { ok: true, result: '0x' + [0n, 0n, 1178941230857609940n, 0n, 0n, 1n, 1n].map(word).join('') }
    if (selector === sel('getUserSuppliedAssets(uint256,address)')) return { ok: true, result: '0x' + word(id === 0 ? 3500000000000000000n : 0n) }
    if (selector === sel('getUserTotalDebt(uint256,address)')) return { ok: true, result: '0x' + word(id === 1 ? 4300000000n : 0n) }
    if (selector === sel('getReserve(uint256)')) {
      return { ok: true, result: '0x' + [BigInt(id === 0 ? WETH : USDC), 1n, 0n, id === 0 ? 18n : 6n, 0n, 12n, 0n].map(word).join('') }
    }
    return { ok: false, error: 'unknown selector' }
  })

const evm = { getTokenMetadata: async (_chain: 'eth' | 'base' | 'bsc', contract: string) => (contract === WETH ? { symbol: 'WETH', decimals: 18 } : { symbol: 'USDC', decimals: 6 }) }
const prices = {
  getTokenPrices: async () =>
    new Map([
      [WETH, dec('2000')],
      [USDC, dec('1')],
    ]),
}

describe('admin aave wallets', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let client = 0
  let remoteAddress = ''

  beforeAll(async () => {
    app = await buildApp({ adminAave: { ethCall, evm, prices } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  beforeEach(async () => {
    remoteAddress = `10.40.0.${++client}`
    await query('DELETE FROM "AaveWallet"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown, authed = true) =>
    app.inject({ method: 'POST', url: '/api/admin/aave/wallets', payload: payload as object, cookies: authed ? cookies : {}, remoteAddress })

  it('requires a session on every route', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const calls = [
      { method: 'GET', url: '/api/admin/aave/wallets' },
      { method: 'GET', url: `/api/admin/aave/wallets/${created.id}/positions` },
      { method: 'POST', url: '/api/admin/aave/wallets', payload: { label: 'X', address: B } },
      { method: 'PATCH', url: `/api/admin/aave/wallets/${created.id}`, payload: { active: false } },
      { method: 'DELETE', url: `/api/admin/aave/wallets/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, call.url, res.statusCode]).toEqual([call.method, call.url, 401])
    }
    expect((await query('SELECT 1 FROM "AaveWallet"')).rowCount).toBe(1)
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
    ['a bitcoin address', '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'],
  ])('rejects an invalid address (%s)', async (_name, address) => {
    const res = await add({ label: 'Main', address })
    expect(res.statusCode).toBe(400)
    expect((await query('SELECT 1 FROM "AaveWallet"')).rowCount).toBe(0)
  })

  it('rejects a blank name and unknown fields', async () => {
    expect((await add({ label: '   ', address: A })).statusCode).toBe(400)
    expect((await add({ label: 'Main', address: A, chain: 'base' })).statusCode).toBe(400)
  })

  it('refuses the same wallet twice, whatever the casing', async () => {
    expect((await add({ label: 'Main', address: A })).statusCode).toBe(201)
    expect((await add({ label: 'Other', address: A_LOWER })).statusCode).toBe(409)
    expect((await query('SELECT 1 FROM "AaveWallet"')).rowCount).toBe(1)
  })

  it('lists wallets with their net value from the latest snapshot, debt included', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const before = await app.inject({ method: 'GET', url: '/api/admin/aave/wallets', cookies })
    expect(before.json().wallets[0]).toMatchObject({ id: created.id, lastValue: null })

    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.1, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'aave', $1, 'WETH', 3.5, 2000, 7000, 6300, false), ('l2', 's1', 'aave', $2, 'USDC', -4300, 1, -4300, -3870, false)`,
      [supplyRef(A_LOWER, 0), debtRef(A_LOWER, 1)]
    )
    const after = await app.inject({ method: 'GET', url: '/api/admin/aave/wallets', cookies })
    expect(after.json().wallets[0].lastValue).toMatchObject({ usd: '2700.00000000', date: '2026-11-20', stale: false })
    expect((await lastRefs(A_LOWER)).sort()).toEqual([supplyRef(A_LOWER, 0), debtRef(A_LOWER, 1)].sort())
    expect(await lastRefs(B)).toEqual([])
  })

  it('pauses and renames a wallet, and a paused wallet is no longer read', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/aave/wallets/${created.id}`, payload, cookies, remoteAddress })

    expect((await patch({ active: false })).json()).toMatchObject({ active: false })
    expect(await activeAddresses()).toEqual([])
    expect((await patch({ active: true, label: ' Renamed ' })).json()).toMatchObject({ active: true, label: 'Renamed' })
    expect(await activeAddresses()).toEqual([A_LOWER])
    expect((await patch({ label: '  ' })).statusCode).toBe(400)
    // The address is the wallet's identity, so it cannot be edited.
    expect((await patch({ address: B })).statusCode).toBe(400)
  })

  it('reads the live position of the stored wallet: collateral, debt, values and health factor', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    const res = await app.inject({ method: 'GET', url: `/api/admin/aave/wallets/${created.id}/positions`, cookies, remoteAddress })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      reserves: [
        { reserveId: 0, symbol: 'WETH', supplied: '3.5', debt: '0', suppliedUsd: '7000.00', debtUsd: '0.00' },
        { reserveId: 1, symbol: 'USDC', supplied: '0', debt: '4300', suppliedUsd: '0.00', debtUsd: '4300.00' },
      ],
      healthFactor: '1.1789',
      warnings: [],
    })
  })

  it('returns 404 for an unknown wallet', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/aave/wallets/nope/positions', cookies, remoteAddress })).statusCode).toBe(404)
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/aave/wallets/nope', payload: { active: false }, cookies, remoteAddress })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/aave/wallets/nope', cookies })).statusCode).toBe(404)
  })

  it('answers 502 when the chain cannot be read, instead of showing an empty position', async () => {
    const own = await buildApp({
      adminAave: {
        ethCall: async () => {
          throw new Error('rpc down')
        },
        evm,
        prices,
      },
    })
    await own.ready()
    try {
      const created = (await add({ label: 'Main', address: A })).json()
      const res = await own.inject({ method: 'GET', url: `/api/admin/aave/wallets/${created.id}/positions`, cookies, remoteAddress })
      expect(res.statusCode).toBe(502)
      expect(res.json().error).toContain('rpc down')
    } finally {
      await own.close()
    }
  })

  it('deleting a wallet keeps snapshot history', async () => {
    const created = (await add({ label: 'Main', address: A })).json()
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 10, 9, 1.1, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'aave', $1, 'WETH', 1, 10, 10, 9, false)`,
      [supplyRef(A_LOWER, 0)]
    )
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/aave/wallets/${created.id}`, cookies })).statusCode).toBe(204)
    expect((await query('SELECT 1 FROM "AaveWallet"')).rowCount).toBe(0)
    expect((await query('SELECT 1 FROM "SnapshotLine"')).rowCount).toBe(1)
  })
})
