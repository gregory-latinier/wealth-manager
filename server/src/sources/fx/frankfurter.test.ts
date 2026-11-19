import fixture from '../crypto/__fixtures__/frankfurter-usd-eur.json'
import { createFrankfurter, parseFrankfurter } from './frankfurter'

describe('parseFrankfurter', () => {
  it('parses the recorded response and inverts it to usdPerEur', () => {
    const rate = parseFrankfurter(fixture)
    expect(rate.date).toBe('2026-11-19')
    expect(rate.usdPerEur.toFixed()).toBe('1.09827351')
  })

  it.each([
    ['zero rate', { ...fixture, rate: 0 }, /positive/],
    ['negative rate', { ...fixture, rate: -0.9 }, /positive/],
    ['non-numeric rate', { ...fixture, rate: 'abc' }, /invalid rate/],
    ['missing rate', { date: fixture.date, base: 'USD', quote: 'EUR' }, /missing rate/],
    ['wrong pair', { ...fixture, quote: 'GBP' }, /unexpected pair/],
    ['bad date', { ...fixture, date: 'yesterday' }, /date/],
    ['empty body', null, /empty response/],
  ])('rejects %s', (_name, payload, message) => {
    expect(() => parseFrankfurter(payload)).toThrow(message)
  })
})

describe('createFrankfurter', () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch

  it('returns the parsed rate', async () => {
    const rate = await createFrankfurter({ fetch: ok(fixture) }).getUsdPerEur()
    expect(rate.usdPerEur.toFixed()).toBe('1.09827351')
  })

  it('throws on an HTTP error so the engine can fall back to the last stored rate', async () => {
    const failing = (async () => new Response('nope', { status: 503 })) as typeof fetch
    await expect(createFrankfurter({ fetch: failing }).getUsdPerEur()).rejects.toThrow(/HTTP 503/)
  })

  it('throws when the network fails', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED')
    }) as typeof fetch
    await expect(createFrankfurter({ fetch: down }).getUsdPerEur()).rejects.toThrow(/ECONNREFUSED/)
  })
})
