import { dec, fromBaseUnits, type Decimal } from '../../lib/money'
import { createCoinGecko } from '../crypto/providers/coingecko'
import { createPriceProvider } from '../crypto/providers/defillama'
import { createEthCall, createEvmRpc } from '../crypto/providers/evm-rpc'
import type { EvmProvider, PriceProvider } from '../crypto/providers/types'
import type { EthCall } from '../smardex/ownership'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { activePositions, type StakingPosition } from './positions'
import { readClaimable } from './rewards'

export const STAKING_SOURCE_ID = 'staking'

export interface StakingDeps {
  prices: Pick<PriceProvider, 'getTokenPrices'>
  positions?: () => Promise<StakingPosition[]>
  /** Reads the staking contract. Only used by positions that track rewards. */
  ethCall?: EthCall
  /** Reads the symbol and decimals of a reward token. Only used by positions that track rewards. */
  evm?: Pick<EvmProvider, 'getTokenMetadata'>
}

/** Stable key of one position. The id never changes, so renaming the platform does not break carry-forward. */
export const stakingRef = (p: Pick<StakingPosition, 'id' | 'symbol'>) => `${p.id}:${p.symbol}`

/** Key of the claimable rewards of one position. It has no symbol so a failed token lookup still matches the earlier line. */
export const rewardsRef = (p: Pick<StakingPosition, 'id'>) => `${p.id}:rewards`

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300)

interface Reward {
  position: StakingPosition
  token: string
  symbol: string
  amount: Decimal
}

export function createStakingSource(deps: StakingDeps): SourceType {
  const load = deps.positions ?? activePositions
  // Created on first use, so a source with no rewards never builds an RPC client.
  let ethCall = deps.ethCall
  let evm = deps.evm

  return {
    id: STAKING_SOURCE_ID,

    async collect(): Promise<CollectResult> {
      const positions = await load()
      if (positions.length === 0) return { lines: [], failures: [] }

      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      // Claimable rewards first, because the reward token is only known after the read and it needs a price too.
      const rewards: Reward[] = []
      for (const p of positions) {
        if (!p.rewardsContract || !p.rewardsWallet) continue
        try {
          ethCall ??= createEthCall('eth')
          evm ??= createEvmRpc()
          const claimable = await readClaimable(ethCall, p.rewardsContract, p.rewardsWallet)
          if (!claimable.ok) {
            failures.push({ sourceRef: rewardsRef(p), reason: claimable.error })
            continue
          }
          const meta = await evm.getTokenMetadata('eth', claimable.token)
          rewards.push({ position: p, token: claimable.token, symbol: meta.symbol, amount: fromBaseUnits(claimable.raw, meta.decimals) })
        } catch (err) {
          failures.push({ sourceRef: rewardsRef(p), reason: `rewards read failed: ${reasonOf(err)}` })
        }
      }

      let prices = new Map<string, Decimal>()
      let priceError = ''
      try {
        prices = await deps.prices.getTokenPrices('eth', [...new Set([...positions.map((p) => p.contract), ...rewards.map((r) => r.token)])])
      } catch (err) {
        priceError = `price lookup failed: ${reasonOf(err)}`
      }

      for (const p of positions) {
        const price = prices.get(p.contract)
        // No price is a failure (carried forward as stale), never a line valued at 0.
        if (!price) failures.push({ sourceRef: stakingRef(p), reason: priceError || `no USD price for ${p.symbol}` })
        else lines.push({ sourceRef: stakingRef(p), symbol: p.symbol, amount: dec(p.amount), priceUsd: price })
      }

      for (const r of rewards) {
        const price = prices.get(r.token)
        if (!price) failures.push({ sourceRef: rewardsRef(r.position), reason: priceError || `no USD price for ${r.symbol}` })
        // Nothing to claim is a real zero, not a failure. A zero line only adds noise to the breakdown.
        else if (!r.amount.isZero()) lines.push({ sourceRef: rewardsRef(r.position), symbol: r.symbol, amount: r.amount, priceUsd: price })
      }
      return { lines, failures }
    },
  }
}

/** The staking source wired to the real price providers and the public Ethereum RPC. */
export function createDefaultStakingSource(): SourceType {
  return createStakingSource({ prices: createPriceProvider(createCoinGecko()) })
}
