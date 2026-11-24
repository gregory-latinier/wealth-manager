import { query } from '../../db/index'
import { dec } from '../../lib/money'
import { deleteSetting, setSetting } from '../../lib/settings'

export const CURRENCIES = ['EUR', 'USD'] as const
export type ThCurrency = (typeof CURRENCIES)[number]

export interface GominingSettings {
  /** What one TH is worth, in `thCurrency`. Null until the owner sets it: miners then cannot be valued. */
  thPrice: string | null
  thCurrency: ThCurrency
  /** BTC rewards waiting in the GoMining wallet. */
  btc: string
  /** GMT tokens held in the GoMining wallet. */
  gmt: string
}

const KEYS = { thPrice: 'gomining.thPrice', thCurrency: 'gomining.thCurrency', btc: 'gomining.btc', gmt: 'gomining.gmt' } as const

// Plain positive decimals: no sign, no exponent. BTC has 8 decimals, GMT and the price per TH are shown with up to 8 and 4.
const TH_PRICE = /^\d{1,10}(\.\d{1,4})?$/
const BTC = /^\d{1,10}(\.\d{1,8})?$/
const GMT = /^\d{1,15}(\.\d{1,8})?$/

/** The value as stored, or null when it is not a plain decimal that fits. Leading zeros and trailing decimals are normalised. */
function normalise(input: string, pattern: RegExp): string | null {
  const text = input.trim()
  return pattern.test(text) ? dec(text).toFixed() : null
}

export const parseThPrice = (input: string) => normalise(input, TH_PRICE)
export const parseBtc = (input: string) => normalise(input, BTC)
export const parseGmt = (input: string) => normalise(input, GMT)

export async function getGominingSettings(): Promise<GominingSettings> {
  const res = await query<{ key: string; value: string }>(`SELECT "key", "value" FROM "Setting" WHERE "key" = ANY($1)`, [Object.values(KEYS)])
  const stored = new Map(res.rows.map((r) => [r.key, r.value]))
  // A hand-edited bad value must not break the snapshot: it counts as not set.
  const currency = stored.get(KEYS.thCurrency)
  return {
    thPrice: parseThPrice(stored.get(KEYS.thPrice) ?? ''),
    thCurrency: currency === 'USD' ? 'USD' : 'EUR',
    btc: parseBtc(stored.get(KEYS.btc) ?? '') ?? '0',
    gmt: parseGmt(stored.get(KEYS.gmt) ?? '') ?? '0',
  }
}

/** Values are already validated. A null price forgets it. */
export async function saveGominingSettings(patch: { thPrice?: string | null; thCurrency?: ThCurrency; btc?: string; gmt?: string }): Promise<void> {
  if (patch.thPrice === null) await deleteSetting(KEYS.thPrice)
  else if (patch.thPrice !== undefined) await setSetting(KEYS.thPrice, patch.thPrice)
  if (patch.thCurrency !== undefined) await setSetting(KEYS.thCurrency, patch.thCurrency)
  if (patch.btc !== undefined) await setSetting(KEYS.btc, patch.btc)
  if (patch.gmt !== undefined) await setSetting(KEYS.gmt, patch.gmt)
}
