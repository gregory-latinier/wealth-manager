import { dec, type Decimal } from '../../lib/money'
import { createCoinGecko } from '../crypto/providers/coingecko'
import { createPriceProvider } from '../crypto/providers/defillama'
import { createEthCall, createEvmRpc } from '../crypto/providers/evm-rpc'
import type { EvmProvider, PriceProvider } from '../crypto/providers/types'
import { reasonOf, type EthCall } from '../smardex/ownership'
import type { CollectResult, HoldingFailure, HoldingLine, SourceType } from '../types'
import { readWallet } from './spoke'
import { activeAddresses, lastRefs } from './wallets'

export const AAVE_SOURCE_ID = 'aave'

export interface AaveDeps {
  prices: Pick<PriceProvider, 'getTokenPrices'>
  /** Addresses to look at: the active wallets of the Aave list. */
  addresses?: () => Promise<string[]>
  /** Refs a wallet had in the latest snapshot. Used to carry them forward when the wallet cannot be read. */
  previousRefs?: (address: string) => Promise<string[]>
  ethCall?: EthCall
  evm?: Pick<EvmProvider, 'getTokenMetadata'>
}

/** Stable keys of one reserve of one wallet. The reserve id never changes, so carry-forward always matches. */
export const supplyRef = (address: string, reserveId: number) => `${address}:${reserveId}:supply`
export const debtRef = (address: string, reserveId: number) => `${address}:${reserveId}:debt`

export function createAaveSource(deps: AaveDeps): SourceType {
  const addresses = deps.addresses ?? activeAddresses
  const previousRefs = deps.previousRefs ?? lastRefs
  // Created on first use, so a source with no wallet never builds an RPC client.
  let ethCall = deps.ethCall
  let evm = deps.evm

  return {
    id: AAVE_SOURCE_ID,

    async collect(): Promise<CollectResult> {
      const wallets = await addresses()
      if (wallets.length === 0) return { lines: [], failures: [] }
      ethCall ??= createEthCall('eth')
      evm ??= createEvmRpc()

      const lines: HoldingLine[] = []
      const failures: HoldingFailure[] = []

      for (const address of wallets) {
        let reading
        try {
          reading = await readWallet(ethCall, evm, address)
        } catch (err) {
          // Unreadable wallet: every earlier line is reported so it is carried forward. Dropping the debt would raise net worth.
          const reason = `could not read the Aave position: ${reasonOf(err)}`
          const refs = await previousRefs(address)
          if (refs.length === 0) failures.push({ sourceRef: `${address}:*`, reason })
          for (const sourceRef of refs) failures.push({ sourceRef, reason })
          continue
        }

        for (const f of reading.failures) {
          const reason = `reserve ${f.reserveId}: ${f.reason}`
          failures.push({ sourceRef: supplyRef(address, f.reserveId), reason }, { sourceRef: debtRef(address, f.reserveId), reason })
        }
        if (reading.positions.length === 0) continue

        let prices = new Map<string, Decimal>()
        let priceError = ''
        try {
          prices = await deps.prices.getTokenPrices('eth', [...new Set(reading.positions.map((p) => p.underlying))])
        } catch (err) {
          priceError = `price lookup failed: ${reasonOf(err)}`
        }

        for (const p of reading.positions) {
          const price = prices.get(p.underlying)
          const entries = [
            { ref: supplyRef(address, p.reserveId), amount: p.supplied },
            // A debt is a negative amount, so it lowers the net worth.
            { ref: debtRef(address, p.reserveId), amount: p.debt.negated() },
          ].filter((e) => !e.amount.isZero())
          for (const e of entries) {
            // No price is a failure (carried forward as stale), never a line valued at 0.
            if (!price) failures.push({ sourceRef: e.ref, reason: priceError || `no USD price for ${p.symbol}` })
            else lines.push({ sourceRef: e.ref, symbol: p.symbol, amount: dec(e.amount), priceUsd: price })
          }
        }
      }

      lines.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      failures.sort((a, b) => a.sourceRef.localeCompare(b.sourceRef))
      return { lines, failures }
    },
  }
}

/** The Aave source wired to the real price providers and the public Ethereum RPC. */
export function createDefaultAaveSource(): SourceType {
  return createAaveSource({ prices: createPriceProvider(createCoinGecko()) })
}
