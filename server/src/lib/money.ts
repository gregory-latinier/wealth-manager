import DecimalBase from 'decimal.js'

// Own constructor so the precision here never leaks into (or from) other users of decimal.js.
export const Decimal = DecimalBase.clone({ precision: 50, rounding: DecimalBase.ROUND_HALF_UP })
export type Decimal = InstanceType<typeof Decimal>

// Scales of the NUMERIC columns (see migrations): token amounts, USD/EUR values, USD/EUR rate.
export const AMOUNT_DP = 18
export const VALUE_DP = 8
export const RATE_DP = 8

/** Parses a decimal string (or number) and rejects anything that is not a finite number. */
export function dec(value: string | number | Decimal): Decimal {
  let d: Decimal
  try {
    d = new Decimal(value)
  } catch {
    throw new Error(`Not a decimal number: ${String(value)}`)
  }
  if (!d.isFinite()) throw new Error(`Not a finite decimal number: ${String(value)}`)
  return d
}

/** Fixed-point string for storage and API output (never exponent notation). */
export function fixed(value: Decimal, dp: number): string {
  return value.toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toFixed(dp)
}

/** Raw integer units (satoshis, wei, token base units) to a human amount. */
export function fromBaseUnits(raw: string | bigint, decimals: number): Decimal {
  return dec(raw.toString()).div(new Decimal(10).pow(decimals))
}

/** Converts USD to EUR with the stored rate (usdPerEur: how many USD one EUR costs). */
export function usdToEur(usd: Decimal, usdPerEur: Decimal): Decimal {
  if (!usdPerEur.isPositive() || usdPerEur.isZero()) throw new Error('usdPerEur must be positive')
  return usd.div(usdPerEur)
}

/** Turns a quote of "EUR per 1 USD" (what Frankfurter returns) into the stored usdPerEur. */
export function usdPerEurFromEurPerUsd(eurPerUsd: Decimal): Decimal {
  if (!eurPerUsd.isPositive() || eurPerUsd.isZero()) throw new Error('Exchange rate must be positive')
  return new Decimal(1).div(eurPerUsd).toDecimalPlaces(RATE_DP, Decimal.ROUND_HALF_UP)
}
