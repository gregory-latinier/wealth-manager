import { dec, usdPerEurFromEurPerUsd, type Decimal } from '../../lib/money'

export interface FxRate {
  /** How many USD one EUR costs, at the stored precision. */
  usdPerEur: Decimal
  /** Date the provider published the rate for (YYYY-MM-DD). */
  date: string
}

export interface FxProvider {
  getUsdPerEur(): Promise<FxRate>
}

const URL_USD_EUR = 'https://api.frankfurter.dev/v2/rate/USD/EUR'
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Validates a Frankfurter `/v2/rate/USD/EUR` payload. Exported for tests. */
export function parseFrankfurter(payload: unknown): FxRate {
  const p = payload as { date?: unknown; base?: unknown; quote?: unknown; rate?: unknown } | null
  if (!p || typeof p !== 'object') throw new Error('Frankfurter: empty response')
  if (p.base !== 'USD' || p.quote !== 'EUR') {
    throw new Error(`Frankfurter: unexpected pair ${String(p.base)}/${String(p.quote)}`)
  }
  if (typeof p.date !== 'string' || !DATE.test(p.date)) throw new Error('Frankfurter: missing or invalid date')
  if (typeof p.rate !== 'number' && typeof p.rate !== 'string') throw new Error('Frankfurter: missing rate')

  let eurPerUsd: Decimal
  try {
    eurPerUsd = dec(p.rate)
  } catch {
    throw new Error('Frankfurter: invalid rate')
  }
  if (!eurPerUsd.isPositive() || eurPerUsd.isZero()) throw new Error('Frankfurter: rate must be positive')

  return { usdPerEur: usdPerEurFromEurPerUsd(eurPerUsd), date: p.date }
}

export function createFrankfurter(options: { fetch?: typeof fetch; timeoutMs?: number } = {}): FxProvider {
  const doFetch = options.fetch ?? fetch
  const timeoutMs = options.timeoutMs ?? 10_000

  return {
    async getUsdPerEur() {
      const res = await doFetch(URL_USD_EUR, { signal: AbortSignal.timeout(timeoutMs) })
      if (!res.ok) throw new Error(`Frankfurter: HTTP ${res.status}`)
      return parseFrankfurter(await res.json())
    },
  }
}
