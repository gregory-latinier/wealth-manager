import { FastifyInstance } from 'fastify'
import { buildApp } from '../index'
import { pool, query } from '../db/index'
import { SESSION_COOKIE } from '../lib/auth'
import { dec } from '../lib/money'
import type { CallOutcome } from '../sources/crypto/providers/evm-rpc'
import { ProviderError, type EvmProvider, type PriceProvider } from '../sources/crypto/providers/types'
import { activePositions, getPosition } from '../sources/staking/positions'

const SDEX = '0x5dE8aB7E27f6E7A1fFf3E5B337584Aa43961BEeF'
const SDEX_LOWER = SDEX.toLowerCase()
const STAKING = '0x25b5D0216D28b3B348738326C514f7d1D4f8Ee2f'
const WALLET = '0x806bE92538e21d63EFf9681F5b96dD4f52BFfF31'
const WORD = '0x' + '0'.repeat(63) + '1'

let known = true
let metadataFails = false
/** What the fake staking contract answers to getEvToken() and getClaimableRewards(). */
let contractAnswers: CallOutcome[] = [
  { ok: true, result: WORD },
  { ok: true, result: WORD },
]
const ethCall = async () => contractAnswers

const evm = {
  getTokenMetadata: async () => {
    if (metadataFails) throw new ProviderError('rpc', 'network', 'down')
    return { symbol: 'SDEX', decimals: 18 }
  },
} as unknown as EvmProvider

const prices = {
  getNativePrices: async () => ({ btc: dec('1'), eth: dec('1') }),
  getTokenPrices: async () => (known ? new Map([[SDEX_LOWER, dec('0.000635')]]) : new Map()),
} as PriceProvider

describe('admin staking positions', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let client = 0
  let remoteAddress = ''

  beforeAll(async () => {
    app = await buildApp({ adminStaking: { evm, prices, ethCall } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  })

  beforeEach(async () => {
    remoteAddress = `10.40.0.${++client}`
    known = true
    metadataFails = false
    contractAnswers = [
      { ok: true, result: WORD },
      { ok: true, result: WORD },
    ]
    await query('DELETE FROM "StakingPosition"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterAll(async () => {
    await app.close()
    await pool.end()
  })

  const add = (payload: unknown) =>
    app.inject({ method: 'POST', url: '/api/admin/staking/positions', payload: payload as object, cookies, remoteAddress })
  const valid = { platform: 'Everything', contract: SDEX, amount: '10000000' }

  it('requires a session on every route', async () => {
    const created = (await add(valid)).json()
    const calls = [
      { method: 'GET', url: '/api/admin/staking/positions' },
      { method: 'POST', url: '/api/admin/staking/positions', payload: valid },
      { method: 'PATCH', url: `/api/admin/staking/positions/${created.id}`, payload: { active: false } },
      { method: 'DELETE', url: `/api/admin/staking/positions/${created.id}` },
    ] as const
    for (const call of calls) {
      const res = await app.inject({ ...call })
      expect([call.method, res.statusCode]).toEqual([call.method, 401])
    }
    expect((await query('SELECT 1 FROM "StakingPosition"')).rowCount).toBe(1)
  })

  it('reads the symbol from the contract and stores the contract lowercase', async () => {
    const res = await add({ ...valid, platform: '  Everything  ' })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ platform: 'Everything', symbol: 'SDEX', contract: SDEX_LOWER, active: true, priced: true, warning: null })
    expect(res.json().amount).toBe('10000000.000000000000000000')
    expect((await activePositions()).map((p) => p.symbol)).toEqual(['SDEX'])
  })

  it('accepts a decimal amount with up to 18 places', async () => {
    expect((await add({ ...valid, amount: '1234.567890123456789012' })).statusCode).toBe(201)
  })

  it.each([
    ['zero', '0'],
    ['negative', '-5'],
    ['exponent', '1e7'],
    ['text', 'ten'],
    ['thousands separator', '10,000,000'],
    ['too many decimals', '1.1234567890123456789'],
    ['too many digits', '123456789012345678901'],
  ])('rejects an invalid amount (%s)', async (_name, amount) => {
    const res = await add({ ...valid, amount })
    expect(res.statusCode).toBe(400)
    expect((await query('SELECT 1 FROM "StakingPosition"')).rowCount).toBe(0)
  })

  it('rejects a bad contract, a blank platform and unknown fields', async () => {
    expect((await add({ ...valid, contract: '0x1234' })).statusCode).toBe(400)
    expect((await add({ ...valid, platform: '   ' })).statusCode).toBe(400)
    expect((await add({ ...valid, symbol: 'FAKE' })).statusCode).toBe(400)
  })

  it('warns when the token has no price, but still adds it', async () => {
    known = false
    const res = await add(valid)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ priced: false })
    expect(res.json().warning).toContain('No price is known')
  })

  it('answers 502 and adds nothing when the token cannot be read from the chain', async () => {
    metadataFails = true
    const res = await add(valid)
    expect(res.statusCode).toBe(502)
    expect((await query('SELECT 1 FROM "StakingPosition"')).rowCount).toBe(0)
  })

  it('refuses the same token on the same platform twice, but allows another platform', async () => {
    expect((await add(valid)).statusCode).toBe(201)
    expect((await add(valid)).statusCode).toBe(409)
    expect((await add({ ...valid, platform: 'Smardex' })).statusCode).toBe(201)
  })

  it('updates the amount, renames the platform and pauses, and a paused position is no longer valued', async () => {
    const created = (await add(valid)).json()
    const patch = (payload: object) => app.inject({ method: 'PATCH', url: `/api/admin/staking/positions/${created.id}`, payload, cookies, remoteAddress })

    expect((await patch({ amount: '12000000.5' })).json()).toMatchObject({ amount: '12000000.500000000000000000' })
    expect((await patch({ platform: ' Renamed ' })).json()).toMatchObject({ platform: 'Renamed' })
    expect((await patch({ active: false })).json()).toMatchObject({ active: false })
    expect(await activePositions()).toEqual([])

    expect((await patch({ amount: '0' })).statusCode).toBe(400)
    // The token is the position's identity, so it cannot be edited.
    expect((await patch({ contract: SDEX })).statusCode).toBe(400)
  })

  it('refuses to rename onto a platform that already tracks the token', async () => {
    const first = (await add(valid)).json()
    await add({ ...valid, platform: 'Smardex' })
    const res = await app.inject({ method: 'PATCH', url: `/api/admin/staking/positions/${first.id}`, payload: { platform: 'Smardex' }, cookies, remoteAddress })
    expect(res.statusCode).toBe(409)
  })

  it('lists positions with their value from the latest snapshot, and null before there is one', async () => {
    const created = (await add(valid)).json()
    const before = await app.inject({ method: 'GET', url: '/api/admin/staking/positions', cookies })
    expect(before.json().positions[0]).toMatchObject({ id: created.id, lastValue: null })

    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.1, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'staking', $1, 'SDEX', 10000000, 0.000635, 6350, 5800, true)`,
      [`${created.id}:SDEX`]
    )
    const after = await app.inject({ method: 'GET', url: '/api/admin/staking/positions', cookies })
    expect(after.json().positions[0].lastValue).toMatchObject({ usd: '6350.00000000', date: '2026-11-20', stale: true })
  })

  describe('claimable rewards', () => {
    const rewards = { contract: STAKING, wallet: WALLET }
    const patchOf = (id: string) => (payload: object) =>
      app.inject({ method: 'PATCH', url: `/api/admin/staking/positions/${id}`, payload, cookies, remoteAddress })

    it('stores the staking contract and wallet lowercase when they answer like a staking contract', async () => {
      const res = await add({ ...valid, rewards })
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ rewardsContract: STAKING.toLowerCase(), rewardsWallet: WALLET.toLowerCase() })
    })

    it('tracks no rewards unless asked', async () => {
      expect((await add(valid)).json()).toMatchObject({ rewardsContract: null, rewardsWallet: null })
    })

    it('refuses a contract that cannot report claimable rewards, and adds nothing', async () => {
      contractAnswers = [
        { ok: true, result: WORD },
        { ok: false, error: 'execution reverted' },
      ]
      const res = await add({ ...valid, rewards })
      expect(res.statusCode).toBe(400)
      expect(res.json().error).toContain('execution reverted')
      expect((await query('SELECT 1 FROM "StakingPosition"')).rowCount).toBe(0)
    })

    it('refuses an answer that is not one 32-byte word', async () => {
      contractAnswers = [
        { ok: true, result: '0x' },
        { ok: true, result: WORD },
      ]
      expect((await add({ ...valid, rewards })).statusCode).toBe(400)
    })

    it.each([
      ['contract', { contract: '0x1234', wallet: WALLET }],
      ['wallet', { contract: STAKING, wallet: 'not-an-address' }],
    ])('refuses a bad %s', async (_name, bad) => {
      expect((await add({ ...valid, rewards: bad })).statusCode).toBe(400)
    })

    it('refuses rewards with only one of the two fields', async () => {
      expect((await add({ ...valid, rewards: { contract: STAKING } })).statusCode).toBe(400)
    })

    it('turns rewards on and off on an existing stake', async () => {
      const created = (await add(valid)).json()
      const patch = patchOf(created.id)
      expect((await patch({ rewards })).json()).toMatchObject({ rewardsContract: STAKING.toLowerCase(), rewardsWallet: WALLET.toLowerCase() })
      expect((await patch({ amount: '5' })).json()).toMatchObject({ rewardsContract: STAKING.toLowerCase() })
      expect((await patch({ rewards: null })).json()).toMatchObject({ rewardsContract: null, rewardsWallet: null })
      expect(await getPosition(created.id)).toMatchObject({ rewardsContract: null, rewardsWallet: null })
    })

    it('keeps the old settings when a new contract is refused', async () => {
      const created = (await add({ ...valid, rewards })).json()
      contractAnswers = [
        { ok: false, error: 'execution reverted' },
        { ok: false, error: 'execution reverted' },
      ]
      const res = await patchOf(created.id)({ rewards: { contract: '0x1111111111111111111111111111111111111111', wallet: WALLET } })
      expect(res.statusCode).toBe(400)
      expect(await getPosition(created.id)).toMatchObject({ rewardsContract: STAKING.toLowerCase() })
    })

    it('lists the value of the stake and of its rewards apart', async () => {
      const created = (await add({ ...valid, rewards })).json()
      await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 100, 90, 1.1, 'complete')`)
      const line = (id: string, ref: string, symbol: string, usd: number, stale: boolean) =>
        query(
          `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
           VALUES ($1, 's1', 'staking', $2, $3, 1, 1, $4, $4, $5)`,
          [id, ref, symbol, usd, stale]
        )
      await line('l1', `${created.id}:SDEX`, 'SDEX', 6350, false)
      await line('l2', `${created.id}:rewards`, 'EV', 134, true)

      const listed = (await app.inject({ method: 'GET', url: '/api/admin/staking/positions', cookies })).json().positions[0]
      expect(listed.lastValue).toMatchObject({ usd: '6350.00000000', stale: false })
      expect(listed.rewardsLastValue).toMatchObject({ usd: '134.00000000', stale: true })
    })
  })

  it('returns 404 for an unknown position and keeps snapshot history when one is deleted', async () => {
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/staking/positions/nope', payload: { active: false }, cookies, remoteAddress })).statusCode).toBe(404)
    expect((await app.inject({ method: 'DELETE', url: '/api/admin/staking/positions/nope', cookies })).statusCode).toBe(404)

    const created = (await add(valid)).json()
    await query(`INSERT INTO "Snapshot" ("id", "date", "totalUsd", "totalEur", "usdPerEur", "status") VALUES ('s1', '2026-11-20', 10, 9, 1.1, 'complete')`)
    await query(
      `INSERT INTO "SnapshotLine" ("id", "snapshotId", "sourceType", "sourceRef", "symbol", "amount", "priceUsd", "valueUsd", "valueEur", "stale")
       VALUES ('l1', 's1', 'staking', $1, 'SDEX', 1, 10, 10, 9, false)`,
      [`${created.id}:SDEX`]
    )
    expect((await app.inject({ method: 'DELETE', url: `/api/admin/staking/positions/${created.id}`, cookies })).statusCode).toBe(204)
    expect((await query('SELECT 1 FROM "StakingPosition"')).rowCount).toBe(0)
    expect((await query('SELECT 1 FROM "SnapshotLine"')).rowCount).toBe(1)
  })
})
