import { dec } from '../../lib/money'
import type { CallOutcome } from '../crypto/providers/evm-rpc'
import { createStakingSource, rewardsRef, stakingRef } from './index'
import type { StakingPosition } from './positions'

const SDEX = '0x5de8ab7e27f6e7a1fff3e5b337584aa43961beef'
const OTHER = '0x1111111111111111111111111111111111111111'
const EV = '0xe7e7e741c23a4767831a56a8c99f522c5ac1e7e7'
const STAKING = '0x25b5d0216d28b3b348738326c514f7d1d4f8ee2f'
const WALLET = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'

const position = (over: Partial<StakingPosition> = {}): StakingPosition => ({
  id: 'sk_1',
  platform: 'Everything',
  symbol: 'SDEX',
  contract: SDEX,
  amount: '10000000',
  active: true,
  createdAt: '2026-11-20T00:00:00Z',
  rewardsContract: null,
  rewardsWallet: null,
  ...over,
})

const build = (positions: StakingPosition[], prices: Map<string, ReturnType<typeof dec>> | Error) =>
  createStakingSource({
    positions: async () => positions,
    prices: {
      getTokenPrices: async () => {
        if (prices instanceof Error) throw prices
        return prices
      },
    },
  })

const word = (value: bigint) => '0x' + value.toString(16).padStart(64, '0')
const tokenWord = '0x' + EV.slice(2).padStart(64, '0')

/** A staking contract answering getEvToken() then getClaimableRewards(wallet), in that order. */
const rewardsCall = (claimable: bigint | CallOutcome = 609914230653000000000000n) => async (): Promise<CallOutcome[]> => [
  { ok: true, result: tokenWord },
  typeof claimable === 'bigint' ? { ok: true, result: word(claimable) } : claimable,
]

const withRewards = (over: Partial<StakingPosition> = {}) => position({ rewardsContract: STAKING, rewardsWallet: WALLET, ...over })

const buildRewards = (
  ethCall: () => Promise<CallOutcome[]>,
  prices: Map<string, ReturnType<typeof dec>> | Error = new Map([
    [SDEX, dec('0.000635')],
    [EV, dec('0.00022')],
  ]),
  evm: { getTokenMetadata: () => Promise<{ symbol: string; decimals: number }> } = { getTokenMetadata: async () => ({ symbol: 'EV', decimals: 18 }) }
) =>
  createStakingSource({
    positions: async () => [withRewards()],
    ethCall,
    evm,
    prices: {
      getTokenPrices: async () => {
        if (prices instanceof Error) throw prices
        return prices
      },
    },
  })

const ctx = { date: '2026-11-20' }

describe('staking source', () => {
  it('values the staked amount at the token price', async () => {
    const res = await build([position()], new Map([[SDEX, dec('0.000635')]])).collect(ctx)
    expect(res.failures).toEqual([])
    expect(res.lines).toHaveLength(1)
    expect(res.lines[0]).toMatchObject({ sourceRef: stakingRef(position()), symbol: 'SDEX' })
    expect(res.lines[0].amount.toString()).toBe('10000000')
    expect(res.lines[0].priceUsd.toString()).toBe('0.000635')
  })

  it('returns nothing when no position is tracked, without asking for prices', async () => {
    let asked = false
    const source = createStakingSource({
      positions: async () => [],
      prices: {
        getTokenPrices: async () => {
          asked = true
          return new Map()
        },
      },
    })
    expect(await source.collect(ctx)).toEqual({ lines: [], failures: [] })
    expect(asked).toBe(false)
  })

  it('reports a token with no price as a failure, never as a line valued at 0', async () => {
    const res = await build([position()], new Map()).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([{ sourceRef: stakingRef(position()), reason: 'no USD price for SDEX' }])
  })

  it('fails every position when the price lookup throws, so they are carried forward', async () => {
    const res = await build([position(), position({ id: 'sk_2', contract: OTHER, symbol: 'ABC' })], new Error('defillama down')).collect(ctx)
    expect(res.lines).toEqual([])
    expect(res.failures.map((f) => f.sourceRef)).toEqual(['sk_1:SDEX', 'sk_2:ABC'])
    expect(res.failures[0].reason).toContain('defillama down')
  })

  it('values the priced position and fails only the unpriced one', async () => {
    const res = await build([position(), position({ id: 'sk_2', contract: OTHER, symbol: 'ABC' })], new Map([[SDEX, dec('0.001')]])).collect(ctx)
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
    expect(res.failures.map((f) => f.sourceRef)).toEqual(['sk_2:ABC'])
  })

  it('keeps the same ref when the platform is renamed, so carry-forward still matches', () => {
    expect(stakingRef(position({ platform: 'Renamed' }))).toBe(stakingRef(position()))
  })

  describe('claimable rewards', () => {
    it('adds the claimable reward token as a second line, valued at its own price', async () => {
      const res = await buildRewards(rewardsCall()).collect(ctx)
      expect(res.failures).toEqual([])
      expect(res.lines.map((l) => [l.sourceRef, l.symbol])).toEqual([
        ['sk_1:SDEX', 'SDEX'],
        ['sk_1:rewards', 'EV'],
      ])
      expect(res.lines[1].amount.toString()).toBe('609914.230653')
      expect(res.lines[1].priceUsd.toString()).toBe('0.00022')
    })

    it('does not read the chain for a position that tracks no rewards', async () => {
      let called = false
      const source = createStakingSource({
        positions: async () => [position()],
        ethCall: async () => {
          called = true
          return []
        },
        prices: { getTokenPrices: async () => new Map([[SDEX, dec('0.001')]]) },
      })
      const res = await source.collect(ctx)
      expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
      expect(called).toBe(false)
    })

    it('has no line when nothing is claimable, and no failure either', async () => {
      const res = await buildRewards(rewardsCall(0n)).collect(ctx)
      expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
      expect(res.failures).toEqual([])
    })

    it('fails the rewards, not the stake, when the contract cannot be read', async () => {
      const res = await buildRewards(rewardsCall({ ok: false, error: 'execution reverted' })).collect(ctx)
      expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
      expect(res.failures).toEqual([{ sourceRef: rewardsRef(position()), reason: expect.stringContaining('execution reverted') }])
    })

    it('fails the rewards when the RPC throws', async () => {
      const res = await buildRewards(async () => {
        throw new Error('rpc down')
      }).collect(ctx)
      expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
      expect(res.failures[0]).toMatchObject({ sourceRef: 'sk_1:rewards', reason: expect.stringContaining('rpc down') })
    })

    it('fails the rewards when the reward token symbol cannot be read', async () => {
      const res = await buildRewards(rewardsCall(), undefined, {
        getTokenMetadata: async () => {
          throw new Error('metadata down')
        },
      }).collect(ctx)
      expect(res.failures).toEqual([{ sourceRef: 'sk_1:rewards', reason: expect.stringContaining('metadata down') }])
      expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
    })

    it('fails the rewards, never values them at 0, when the reward token has no price', async () => {
      const res = await buildRewards(rewardsCall(), new Map([[SDEX, dec('0.000635')]])).collect(ctx)
      expect(res.lines.map((l) => l.sourceRef)).toEqual(['sk_1:SDEX'])
      expect(res.failures).toEqual([{ sourceRef: 'sk_1:rewards', reason: 'no USD price for EV' }])
    })

    it('fails both the stake and the rewards when the price lookup throws', async () => {
      const res = await buildRewards(rewardsCall(), new Error('defillama down')).collect(ctx)
      expect(res.lines).toEqual([])
      expect(res.failures.map((f) => f.sourceRef)).toEqual(['sk_1:SDEX', 'sk_1:rewards'])
    })

    it('prices the stake and the reward token in one lookup', async () => {
      let asked: string[] = []
      const source = createStakingSource({
        positions: async () => [withRewards()],
        ethCall: rewardsCall(),
        evm: { getTokenMetadata: async () => ({ symbol: 'EV', decimals: 18 }) },
        prices: {
          getTokenPrices: async (_chain, contracts) => {
            asked = [...contracts]
            return new Map([
              [SDEX, dec('1')],
              [EV, dec('1')],
            ])
          },
        },
      })
      await source.collect(ctx)
      expect(asked.sort()).toEqual([EV, SDEX].sort())
    })
  })
})
