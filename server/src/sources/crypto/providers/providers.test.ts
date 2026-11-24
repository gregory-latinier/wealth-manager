import { readFileSync } from 'fs'
import { join } from 'path'
import { createBtcProvider, parseMempoolAddress } from './btc'
import { createCoinGecko, parseNativePrices, parseTokenPrices } from './coingecko'
import { createEvmRpc, decodeDecimals, decodeSymbol, rpcUrlsFromEnv } from './evm-rpc'
import { createLimiter, fetchJson } from './http'
import { ProviderError } from './types'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8'))

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

/** A fetch that answers from a queue and records the calls it received. */
function fakeFetch(...answers: Array<Response | Error | ((url: string, init: RequestInit) => Response)>) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = answers.length > 1 ? answers.shift()! : answers[0]
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next(url, init) : next.clone()
  }) as unknown as typeof fetch
  return { fetch: impl, calls }
}

/** A fetch that never answers but honours the abort signal, like the real one. */
const hangingUntilAbort = ((_url: string, init: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
  })) as unknown as typeof fetch

const ADDRESS = '0xabcdef0123456789abcdef0123456789abcdef01'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'

async function expectProviderError(promise: Promise<unknown>, kind: ProviderError['kind']) {
  const err = await promise.then(
    () => undefined,
    (e) => e
  )
  expect(err).toBeInstanceOf(ProviderError)
  expect((err as ProviderError).kind).toBe(kind)
}

describe('fetchJson', () => {
  it('maps a timeout, a network error, an HTTP error and a bad body to typed errors', async () => {
    await expectProviderError(fetchJson('x', hangingUntilAbort, 'http://x', { timeoutMs: 20 }), 'timeout')
    await expectProviderError(fetchJson('x', fakeFetch(new TypeError('fetch failed')).fetch, 'http://x'), 'network')
    await expectProviderError(fetchJson('x', fakeFetch(json({}, 503)).fetch, 'http://x'), 'http')
    await expectProviderError(fetchJson('x', fakeFetch(new Response('<html>', { status: 200 })).fetch, 'http://x'), 'malformed')
  })
})

describe('createLimiter', () => {
  it('never runs more than the cap at once and still runs every task', async () => {
    const limit = createLimiter(2)
    let running = 0
    let peak = 0
    const task = async (n: number) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return n
    }
    const results = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => limit(() => task(n))))
    expect(results).toEqual([1, 2, 3, 4, 5, 6])
    expect(peak).toBe(2)
  })

  it('releases its slot when a task throws', async () => {
    const limit = createLimiter(1)
    await expect(limit(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
    await expect(limit(async () => 'next')).resolves.toBe('next')
  })
})

describe('btc (mempool.space)', () => {
  it('parses the confirmed balance and ignores the mempool (fixture)', () => {
    // funded 150000000 - spent 50000000 = 100000000 sats; mempool_stats funded 9692 is ignored
    expect(parseMempoolAddress(fixture('mempool-address.json')).toFixed(8)).toBe('1.00000000')
  })

  it('keeps full satoshi precision', () => {
    const payload = { chain_stats: { funded_txo_sum: 123456789, spent_txo_sum: 1 } }
    expect(parseMempoolAddress(payload).toFixed(8)).toBe('1.23456788')
  })

  it('rejects malformed bodies instead of returning 0', () => {
    for (const bad of [null, {}, { chain_stats: {} }, { chain_stats: { funded_txo_sum: '5', spent_txo_sum: 0 } }, { chain_stats: { funded_txo_sum: 1, spent_txo_sum: 2 } }]) {
      expect(() => parseMempoolAddress(bad)).toThrow(ProviderError)
    }
  })

  it('requests the address endpoint and surfaces provider errors', async () => {
    const ok = fakeFetch(json(fixture('mempool-address.json')))
    const balance = await createBtcProvider({ fetch: ok.fetch }).getBalance('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')
    expect(balance.toFixed(8)).toBe('1.00000000')
    expect(ok.calls[0].url).toBe('https://mempool.space/api/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')

    await expectProviderError(createBtcProvider({ fetch: fakeFetch(json({}, 429)).fetch }).getBalance('x'), 'http')
    await expectProviderError(createBtcProvider({ fetch: hangingUntilAbort, timeoutMs: 20 }).getBalance('x'), 'timeout')
  })
})

describe('evm-rpc', () => {
  // eth_getBalance 0x2b6beb6635f3db28 = 3128853190363306792 wei; balanceOf 0x04e0503c = 81809468 raw (6 decimals)
  const nativeOk = { jsonrpc: '2.0', id: 1, result: fixture('base-rpc-eth-getbalance.json').result }
  const tokenOk = { jsonrpc: '2.0', id: 2, result: fixture('base-rpc-erc20-balanceof.json').result }

  it('parses native and ERC-20 balances from a batch (fixtures)', async () => {
    const f = fakeFetch(json([tokenOk, nativeOk])) // out of order on purpose: matched by id
    const rpc = createEvmRpc({ fetch: f.fetch, urls: { base: ['https://rpc.test'] } })
    const out = await rpc.getBalances('base', ADDRESS, [{ contract: USDC, decimals: 6 }])

    expect(out.native.toFixed(18)).toBe('3.128853190363306792')
    const usdc = out.tokens[USDC]
    expect(usdc.ok && usdc.balance.toFixed(6)).toBe('81.809468')

    const sent = JSON.parse(f.calls[0].init.body as string)
    expect(sent).toHaveLength(2)
    expect(sent[0]).toMatchObject({ method: 'eth_getBalance', params: [ADDRESS, 'latest'] })
    expect(sent[1].params[0]).toEqual({
      to: USDC,
      data: '0x70a08231' + '000000000000000000000000abcdef0123456789abcdef0123456789abcdef01',
    })
  })

  it('a failing token does not hide the others, and is never reported as 0', async () => {
    const f = fakeFetch(
      json([
        nativeOk,
        { jsonrpc: '2.0', id: 2, error: { code: -32000, message: 'execution reverted' } },
        { jsonrpc: '2.0', id: 3, result: '0x' }, // not a contract
        { jsonrpc: '2.0', id: 4, result: tokenOk.result },
      ])
    )
    const rpc = createEvmRpc({ fetch: f.fetch, urls: { base: ['https://rpc.test'] } })
    const tokens = [
      { contract: '0x' + '1'.repeat(40), decimals: 6 },
      { contract: '0x' + '2'.repeat(40), decimals: 6 },
      { contract: USDC, decimals: 6 },
    ]
    const out = await rpc.getBalances('base', ADDRESS, tokens)

    const [bad1, bad2, good] = tokens.map((t) => out.tokens[t.contract])
    expect(bad1.ok).toBe(false)
    expect(!bad1.ok && bad1.error.kind).toBe('rpc')
    expect(bad2.ok).toBe(false)
    expect(!bad2.ok && bad2.error.kind).toBe('malformed')
    expect(good.ok && good.balance.toFixed(6)).toBe('81.809468')
  })

  it('fails the whole address when the native balance fails', async () => {
    const f = fakeFetch(json([{ jsonrpc: '2.0', id: 1, error: { code: -32005, message: 'rate limited' } }]))
    const rpc = createEvmRpc({ fetch: f.fetch, urls: { eth: ['https://rpc.test'] } })
    await expectProviderError(rpc.getBalances('eth', ADDRESS, []), 'rpc')
  })

  it('treats a non-batch answer or a non-hex result as malformed', async () => {
    const single = createEvmRpc({ fetch: fakeFetch(json({ jsonrpc: '2.0', id: 1, result: '0x1' })).fetch, urls: { eth: ['https://rpc.test'] } })
    await expectProviderError(single.getBalances('eth', ADDRESS, []), 'malformed')

    const notHex = createEvmRpc({ fetch: fakeFetch(json([{ jsonrpc: '2.0', id: 1, result: 'oops' }])).fetch, urls: { eth: ['https://rpc.test'] } })
    await expectProviderError(notHex.getBalances('eth', ADDRESS, []), 'malformed')
  })

  it('falls back to the next RPC URL, and gives up with the last error when all fail', async () => {
    const f = fakeFetch(json({}, 503), json([nativeOk]))
    const rpc = createEvmRpc({ fetch: f.fetch, urls: { base: ['https://first.test', 'https://second.test'] } })
    const out = await rpc.getBalances('base', ADDRESS, [])
    expect(out.native.toFixed(18)).toBe('3.128853190363306792')
    expect(f.calls.map((c) => c.url)).toEqual(['https://first.test', 'https://second.test'])

    const down = createEvmRpc({ fetch: fakeFetch(json({}, 503)).fetch, urls: { base: ['https://a.test', 'https://b.test'] } })
    await expectProviderError(down.getBalances('base', ADDRESS, []), 'http')
  })

  it('times out per request', async () => {
    const rpc = createEvmRpc({ fetch: hangingUntilAbort, timeoutMs: 20, urls: { eth: ['https://rpc.test'] } })
    await expectProviderError(rpc.getBalances('eth', ADDRESS, []), 'timeout')
  })

  it('caps concurrent requests', async () => {
    let running = 0
    let peak = 0
    const slow = (async () => {
      running++
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, 5))
      running--
      return json([nativeOk])
    }) as unknown as typeof fetch
    const rpc = createEvmRpc({ fetch: slow, concurrency: 2, urls: { eth: ['https://rpc.test'] } })
    await Promise.all(Array.from({ length: 6 }, () => rpc.getBalances('eth', ADDRESS, [])))
    expect(peak).toBe(2)
  })

  it('reads symbol and decimals for a manual add', async () => {
    const usdcSymbol = '0x' + '20'.padStart(64, '0') + '4'.padStart(64, '0') + Buffer.from('USDC').toString('hex').padEnd(64, '0')
    const f = fakeFetch(
      json([
        { jsonrpc: '2.0', id: 1, result: '0x' + '6'.padStart(64, '0') },
        { jsonrpc: '2.0', id: 2, result: usdcSymbol },
      ])
    )
    const meta = await createEvmRpc({ fetch: f.fetch, urls: { base: ['https://rpc.test'] } }).getTokenMetadata('base', USDC)
    expect(meta).toEqual({ symbol: 'USDC', decimals: 6 })
  })

  describe('decoders', () => {
    const abiString = (s: string) =>
      '0x' + '20'.padStart(64, '0') + s.length.toString(16).padStart(64, '0') + Buffer.from(s).toString('hex').padEnd(Math.ceil(s.length / 32) * 64, '0')

    it('decodes an ABI string and a bytes32 symbol', () => {
      expect(decodeSymbol(abiString('WETH'))).toBe('WETH')
      expect(decodeSymbol('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0'))).toBe('MKR')
    })

    it('strips control characters and caps the length of hostile symbols', () => {
      expect(decodeSymbol(abiString('A\u0007B\nC'))).toBe('ABC')
      expect(decodeSymbol(abiString('X'.repeat(80)))).toHaveLength(32)
    })

    it('rejects empty, truncated or inconsistent symbol data', () => {
      for (const bad of ['0x', '0x1234', '0x' + '00'.repeat(32), abiString('').replace(/0+$/, '0'), '0x' + '20'.padStart(64, '0') + 'ff'.padStart(64, '0')]) {
        expect(() => decodeSymbol(bad)).toThrow(ProviderError)
      }
    })

    it('decodes decimals and rejects empty or absurd values', () => {
      expect(decodeDecimals('0x' + '12'.padStart(64, '0'))).toBe(18)
      expect(() => decodeDecimals('0x')).toThrow(ProviderError)
      expect(() => decodeDecimals('0x' + 'ff'.padStart(64, '0'))).toThrow(ProviderError)
    })
  })

  it('reads RPC URLs from the environment, falling back to the defaults', () => {
    expect(rpcUrlsFromEnv({ BASE_RPC_URL: 'https://a.test, https://b.test' } as NodeJS.ProcessEnv)).toEqual({
      eth: ['https://ethereum-rpc.publicnode.com'],
      base: ['https://a.test', 'https://b.test'],
      bsc: ['https://bsc-dataseed1.binance.org', 'https://bsc-rpc.publicnode.com'],
      arb: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    })
    expect(rpcUrlsFromEnv({ ETH_RPC_URL: '  ' } as NodeJS.ProcessEnv).eth).toEqual(['https://ethereum-rpc.publicnode.com'])
    expect(rpcUrlsFromEnv({ BSC_RPC_URL: 'https://bsc.test' } as NodeJS.ProcessEnv).bsc).toEqual(['https://bsc.test'])
    expect(rpcUrlsFromEnv({ ARB_RPC_URL: 'https://arb.test' } as NodeJS.ProcessEnv).arb).toEqual(['https://arb.test'])
  })
})

describe('coingecko', () => {
  it('parses native prices (fixture)', () => {
    const { btc, eth } = parseNativePrices(fixture('coingecko-simple-price.json'))
    expect(btc.toString()).toBe('63953')
    expect(eth.toString()).toBe('1812.27')
  })

  it('returns the BNB price when present and leaves it out when absent', () => {
    expect(parseNativePrices({ bitcoin: { usd: 1 }, ethereum: { usd: 2 }, binancecoin: { usd: 600.5 } }).bnb?.toString()).toBe('600.5')
    expect(parseNativePrices({ bitcoin: { usd: 1 }, ethereum: { usd: 2 } }).bnb).toBeUndefined()
    // A missing BNB price must not break Bitcoin and Ethereum valuation.
    expect(parseNativePrices({ bitcoin: { usd: 1 }, ethereum: { usd: 2 }, binancecoin: { usd: 0 } }).bnb).toBeUndefined()
  })

  it('returns the SOL price when present and leaves it out when absent', () => {
    expect(parseNativePrices({ bitcoin: { usd: 1 }, ethereum: { usd: 2 }, solana: { usd: 70.74 } }).sol?.toString()).toBe('70.74')
    // A missing SOL price must not break the other chains.
    const without = parseNativePrices({ bitcoin: { usd: 1 }, ethereum: { usd: 2 } })
    expect(without.sol).toBeUndefined()
    expect(without.btc.toString()).toBe('1')
  })

  it('requires both native prices', () => {
    expect(() => parseNativePrices({ bitcoin: { usd: 1 } })).toThrow(ProviderError)
    expect(() => parseNativePrices({ bitcoin: { usd: 1 }, ethereum: { usd: 0 } })).toThrow(ProviderError)
    expect(() => parseNativePrices([])).toThrow(ProviderError)
  })

  it('parses a token price and treats a missing contract as unpriced (fixture)', () => {
    const prices = parseTokenPrices(fixture('coingecko-token-price-base.json'), [USDC, '0x' + '9'.repeat(40)])
    expect(prices.get(USDC)?.toString()).toBe('0.999621')
    expect(prices.has('0x' + '9'.repeat(40))).toBe(false)
  })

  it('treats null or zero prices as unpriced and rejects garbage', () => {
    const c = '0x' + '3'.repeat(40)
    expect(parseTokenPrices({ [c]: { usd: null } }, [c]).size).toBe(0)
    expect(parseTokenPrices({ [c]: { usd: 0 } }, [c]).size).toBe(0)
    expect(parseTokenPrices({ [c]: {} }, [c]).size).toBe(0)
    expect(() => parseTokenPrices({ [c]: { usd: '1' } }, [c])).toThrow(ProviderError)
    expect(() => parseTokenPrices({ [c]: { usd: -1 } }, [c])).toThrow(ProviderError)
  })

  it('queries the right platform with lowercase, deduplicated contracts and batches large lists', async () => {
    const f = fakeFetch(json(fixture('coingecko-token-price-base.json')))
    const cg = createCoinGecko({ fetch: f.fetch })
    const prices = await cg.getTokenPrices('base', [USDC.toUpperCase().replace('0X', '0x'), USDC])
    expect(prices.get(USDC)?.toString()).toBe('0.999621')
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0].url).toBe(`https://api.coingecko.com/api/v3/simple/token_price/base?contract_addresses=${USDC}&vs_currencies=usd`)

    const contracts = Array.from({ length: 250 }, (_, i) => '0x' + i.toString(16).padStart(40, '0'))
    const many = fakeFetch(json({}))
    await createCoinGecko({ fetch: many.fetch, apiKey: 'secret' }).getTokenPrices('eth', contracts)
    expect(many.calls).toHaveLength(3)
    expect(many.calls[0].url).toContain('/simple/token_price/ethereum')

    // The keyless free tier refuses more than one contract per request (HTTP 400, error 10012).
    const keyless = fakeFetch(json({}))
    await createCoinGecko({ fetch: keyless.fetch, apiKey: '' }).getTokenPrices('eth', contracts.slice(0, 4))
    expect(keyless.calls).toHaveLength(4)
    expect(keyless.calls.every((c) => c.url.split('contract_addresses=')[1].split('&')[0].split(',').length === 1)).toBe(true)

    const bsc = fakeFetch(json({}))
    await createCoinGecko({ fetch: bsc.fetch }).getTokenPrices('bsc', [USDC])
    expect(bsc.calls[0].url).toContain('/simple/token_price/binance-smart-chain')

    const arb = fakeFetch(json({}))
    await createCoinGecko({ fetch: arb.fetch }).getTokenPrices('arb', [USDC])
    expect(arb.calls[0].url).toContain('/simple/token_price/arbitrum-one')
  })

  it('sends the optional API key and surfaces provider errors', async () => {
    const f = fakeFetch(json(fixture('coingecko-simple-price.json')))
    await createCoinGecko({ fetch: f.fetch, apiKey: 'secret' }).getNativePrices()
    expect(f.calls[0].url).toContain('ids=bitcoin,ethereum,binancecoin')
    expect((f.calls[0].init.headers as Record<string, string>)['x-cg-demo-api-key']).toBe('secret')

    await expectProviderError(createCoinGecko({ fetch: fakeFetch(json({}, 429)).fetch, apiKey: '' }).getNativePrices(), 'http')
    await expectProviderError(createCoinGecko({ fetch: hangingUntilAbort, timeoutMs: 20, apiKey: '' }).getNativePrices(), 'timeout')
  })
})
