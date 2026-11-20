import { createDefiLlamaTokenPrices, createPriceProvider, parseLlamaPrices } from './defillama'
import { ProviderError, type PriceProvider } from './types'
import { dec } from '../../../lib/money'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function fakeFetch(answer: Response | ((url: string) => Response)) {
  const calls: string[] = []
  const impl = (async (url: string) => {
    calls.push(url)
    return typeof answer === 'function' ? answer(url) : answer.clone()
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

const USDT = '0x55d398326f99059ff775485246999027b3197955'
const CAKE = '0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82'

describe('parseLlamaPrices', () => {
  it('reads prices by chain and contract, and leaves unknown or zero-priced tokens out', () => {
    const body = { coins: { [`bsc:${USDT}`]: { price: 0.9992 }, [`bsc:${CAKE}`]: { price: 0 } } }
    const prices = parseLlamaPrices(body, 'bsc', [USDT, CAKE, '0x' + '1'.repeat(40)])
    expect(prices.get(USDT)?.toString()).toBe('0.9992')
    expect(prices.size).toBe(1)
  })

  it('matches keys case-insensitively and ignores other chains', () => {
    const body = { coins: { [`BSC:${USDT.toUpperCase().replace('0X', '0x')}`]: { price: 1 }, [`base:${CAKE}`]: { price: 5 } } }
    const prices = parseLlamaPrices(body, 'bsc', [USDT, CAKE])
    expect([...prices.keys()]).toEqual([USDT])
  })

  it('rejects a payload without coins and a non-numeric or negative price', () => {
    expect(() => parseLlamaPrices({}, 'bsc', [USDT])).toThrow(ProviderError)
    expect(() => parseLlamaPrices(null, 'bsc', [USDT])).toThrow(ProviderError)
    expect(() => parseLlamaPrices({ coins: { [`bsc:${USDT}`]: { price: '1' } } }, 'bsc', [USDT])).toThrow(ProviderError)
    expect(() => parseLlamaPrices({ coins: { [`bsc:${USDT}`]: { price: -1 } } }, 'bsc', [USDT])).toThrow(ProviderError)
  })
})

describe('createDefiLlamaTokenPrices', () => {
  it('asks for many contracts in one request, deduplicated and lowercase', async () => {
    const f = fakeFetch(json({ coins: { [`bsc:${USDT}`]: { price: 1 }, [`bsc:${CAKE}`]: { price: 1.59 } } }))
    const prices = await createDefiLlamaTokenPrices({ fetch: f.fetch }).getTokenPrices('bsc', [USDT.toUpperCase().replace('0X', '0x'), USDT, CAKE])
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]).toBe(`https://coins.llama.fi/prices/current/bsc:${USDT},bsc:${CAKE}?searchWidth=4h`)
    expect(prices.size).toBe(2)
  })

  it('splits very long lists and uses the right chain prefix', async () => {
    const f = fakeFetch(json({ coins: {} }))
    await createDefiLlamaTokenPrices({ fetch: f.fetch }).getTokenPrices(
      'eth',
      Array.from({ length: 120 }, (_, i) => '0x' + i.toString(16).padStart(40, '0'))
    )
    expect(f.calls).toHaveLength(3)
    expect(f.calls[0]).toContain('/prices/current/ethereum:0x')
  })

  it('turns an HTTP failure into a ProviderError', async () => {
    const f = fakeFetch(json({}, 500))
    await expect(createDefiLlamaTokenPrices({ fetch: f.fetch }).getTokenPrices('bsc', [USDT])).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('createPriceProvider', () => {
  const native = (tokens: PriceProvider['getTokenPrices']): PriceProvider => ({
    getNativePrices: async () => ({ btc: dec(1), eth: dec(2) }),
    getTokenPrices: tokens,
  })

  it('uses DefiLlama for tokens and keeps native prices on the native provider', async () => {
    const fallback = jest.fn()
    const provider = createPriceProvider(native(fallback), { getTokenPrices: async () => new Map([[USDT, dec(1)]]) })
    expect((await provider.getTokenPrices('bsc', [USDT])).get(USDT)?.toString()).toBe('1')
    expect(fallback).not.toHaveBeenCalled()
    expect((await provider.getNativePrices()).eth.toString()).toBe('2')
  })

  it('does not fall back when DefiLlama simply does not know a token', async () => {
    const fallback = jest.fn()
    const provider = createPriceProvider(native(fallback), { getTokenPrices: async () => new Map() })
    expect((await provider.getTokenPrices('bsc', [USDT])).size).toBe(0)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back to the native provider when DefiLlama fails', async () => {
    const fallback = jest.fn(async () => new Map([[USDT, dec('0.99')]]))
    const provider = createPriceProvider(native(fallback), {
      getTokenPrices: async () => {
        throw new ProviderError('defillama', 'http', 'HTTP 503')
      },
    })
    expect((await provider.getTokenPrices('bsc', [USDT])).get(USDT)?.toString()).toBe('0.99')
  })

  it('does not hide a bug: a non-provider error is rethrown', async () => {
    const provider = createPriceProvider(native(jest.fn()), {
      getTokenPrices: async () => {
        throw new TypeError('bug')
      },
    })
    await expect(provider.getTokenPrices('bsc', [USDT])).rejects.toThrow(TypeError)
  })
})
