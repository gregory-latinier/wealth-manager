import { dec, type Decimal } from '../../lib/money'
import { createCoinGecko } from '../crypto/providers/coingecko'
import { createPriceProvider } from '../crypto/providers/defillama'
import type { PriceProvider } from '../crypto/providers/types'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { activeMiners, type Miner } from './miners'
import { getGominingSettings, type GominingSettings } from './settings'

export const GOMINING_SOURCE_ID = 'gomining'
/** The GMT token on Ethereum, which the price providers look up by contract. */
export const GMT_CONTRACT = '0x7ddc52c4de30e94be3a6a0a2b259b2850f421989'

export interface GominingDeps {
  prices: Pick<PriceProvider, 'getNativePrices' | 'getTokenPrices'>
  miners?: () => Promise<Miner[]>
  settings?: () => Promise<GominingSettings>
}

/** Stable key of one miner. The id never changes, so renaming or upgrading a miner keeps its history. */
export const minerRef = (m: Pick<Miner, 'id'>) => `${m.id}:TH`
export const WALLET_BTC_REF = 'wallet:BTC'
export const WALLET_GMT_REF = 'wallet:GMT'

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300)

export function createGominingSource(deps: GominingDeps): SourceType {
  const loadMiners = deps.miners ?? activeMiners
  const loadSettings = deps.settings ?? getGominingSettings

  return {
    id: GOMINING_SOURCE_ID,

    async collect(ctx): Promise<CollectResult> {
      const [miners, settings] = await Promise.all([loadMiners(), loadSettings()])
      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      // What one TH is worth, in USD. The owner sets it, there is no market feed for it.
      let thUsd: Decimal | null = null
      let thProblem = ''
      if (miners.length > 0) {
        if (!settings.thPrice) thProblem = 'the value per TH is not set'
        else if (settings.thCurrency === 'USD') thUsd = dec(settings.thPrice)
        else if (ctx.usdPerEur) thUsd = dec(settings.thPrice).times(ctx.usdPerEur)
        else thProblem = 'the EUR/USD rate is unavailable'
      }
      for (const miner of miners) {
        // No price is a failure (carried forward as stale), never a line valued at 0.
        if (thUsd) lines.push({ sourceRef: minerRef(miner), symbol: 'TH', amount: dec(miner.th), priceUsd: thUsd })
        else failures.push({ sourceRef: minerRef(miner), reason: thProblem })
      }

      // Wallet balances. A balance of 0 is nothing held, not a failure, and a zero line would only add noise.
      const btc = dec(settings.btc)
      const gmt = dec(settings.gmt)
      if (!btc.isZero()) {
        try {
          lines.push({ sourceRef: WALLET_BTC_REF, symbol: 'BTC', amount: btc, priceUsd: (await deps.prices.getNativePrices()).btc })
        } catch (err) {
          failures.push({ sourceRef: WALLET_BTC_REF, reason: `price lookup failed: ${reasonOf(err)}` })
        }
      }
      if (!gmt.isZero()) {
        try {
          const price = (await deps.prices.getTokenPrices('eth', [GMT_CONTRACT])).get(GMT_CONTRACT)
          if (price) lines.push({ sourceRef: WALLET_GMT_REF, symbol: 'GMT', amount: gmt, priceUsd: price })
          else failures.push({ sourceRef: WALLET_GMT_REF, reason: 'no USD price for GMT' })
        } catch (err) {
          failures.push({ sourceRef: WALLET_GMT_REF, reason: `price lookup failed: ${reasonOf(err)}` })
        }
      }

      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

/** The GoMining source wired to the real price providers. */
export const createDefaultGominingSource = (): SourceType => createGominingSource({ prices: createPriceProvider(createCoinGecko()) })
