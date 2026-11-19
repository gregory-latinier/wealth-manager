import { Decimal, dec, fixed, fromBaseUnits, usdPerEurFromEurPerUsd, usdToEur } from './money'

describe('money', () => {
  it('does not produce float artifacts', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in floats
    expect(fixed(dec('0.1').plus(dec('0.2')), 8)).toBe('0.30000000')
  })

  it('converts base units exactly, including 18-decimal wei', () => {
    expect(fromBaseUnits('150000000', 8).toFixed()).toBe('1.5')
    expect(fromBaseUnits('1234567890123456789', 18).toFixed()).toBe('1.234567890123456789')
    expect(fromBaseUnits(1n, 18).toFixed()).toBe('0.000000000000000001')
  })

  it('inverts the Frankfurter quote into usdPerEur at 8 decimals', () => {
    // 1 / 0.91052 = 1.098273514... (checked with BigInt long division), rounded to 8 decimals
    const usdPerEur = usdPerEurFromEurPerUsd(dec(0.91052))
    expect(usdPerEur.toFixed()).toBe('1.09827351')
  })

  it('converts USD to EUR with the stored rate', () => {
    // 1000 USD at 1.25 USD per EUR is exactly 800 EUR
    expect(fixed(usdToEur(dec('1000'), dec('1.25')), 8)).toBe('800.00000000')
    // 100 USD at the stored 1.09827351 is 91.05200... EUR (100 * 0.91052 = 91.052)
    expect(fixed(usdToEur(dec('100'), dec('1.09827351')), 2)).toBe('91.05')
  })

  it('rounds half up when fixing scale', () => {
    expect(fixed(dec('1.005'), 2)).toBe('1.01')
    expect(fixed(dec('-1.005'), 2)).toBe('-1.01')
  })

  it('never uses exponent notation in fixed output', () => {
    expect(fixed(dec('1e-7'), 8)).toBe('0.00000010')
    expect(fixed(dec('1e21'), 2)).toBe('1000000000000000000000.00')
  })

  it('rejects garbage and non-finite input', () => {
    expect(() => dec('abc')).toThrow(/Not a decimal/)
    expect(() => dec('')).toThrow(/Not a decimal/)
    expect(() => dec('Infinity')).toThrow(/finite/)
    expect(() => dec(NaN)).toThrow(/finite/)
  })

  it('rejects zero or negative rates', () => {
    expect(() => usdPerEurFromEurPerUsd(dec(0))).toThrow(/positive/)
    expect(() => usdPerEurFromEurPerUsd(dec(-1))).toThrow(/positive/)
    expect(() => usdToEur(dec(1), dec(0))).toThrow(/positive/)
  })

  it('keeps its own precision config', () => {
    expect(new Decimal(1).div(3).toFixed().length).toBeGreaterThan(30)
  })
})
