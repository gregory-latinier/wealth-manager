import { readFileSync } from 'fs'
import { join } from 'path'
import { FastifyInstance } from 'fastify'
import { buildApp } from '../../index'
import { pool, query } from '../../db/index'
import { SESSION_COOKIE } from '../../lib/auth'
import { createBlockscout, parseTokenBalances, type ScanProvider, type ScanToken } from './providers/blockscout'
import { dec } from '../../lib/money'
import { createScanProvider, KNOWN_TOKENS } from './providers/known-tokens'
import { ProviderError, type EvmProvider, type PriceProvider, type TokenBalance } from './providers/types'

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'))

const EVM = '0xabcdef0123456789abcdef0123456789abcdef01'
const ENS = '0x00000000000000000000000000000000000a11ce'
const WHITE = '0x00000000000000000000000000000000000a11cf'
const NOT = '0x00000000000000000000000000000000000a11d0'
const BTC = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('blockscout parser', () => {
  it('keeps only ERC-20 entries and parses amounts exactly (fixture)', () => {
    const tokens = parseTokenBalances(fixture('blockscout-eth-token-balances.json'))
    // ERC-721 (CALCULATOR) and ERC-1155 (ERS) are dropped
    expect(tokens.map((t) => t.symbol)).toEqual(['ENS', 'WHITE', 'NOT'])
    const ens = tokens[0]
    expect(ens.contract).toBe(ENS)
    expect(ens.balance.toFixed(18)).toBe('1144.036076063671431479')
    expect(ens.priceUsd?.toString()).toBe('3.95')
    expect(tokens[2].priceUsd).toBeNull() // exchange_rate null = unpriced, never 0
  })

  it('accepts the keyed { items } page shape too', () => {
    const items = fixture('blockscout-eth-token-balances.json')
    expect(parseTokenBalances({ items, next_page_params: null })).toHaveLength(3)
  })

  it('skips malformed entries, sanitises text, and rejects a body that is not a list', () => {
    const good = {
      token: { address_hash: ENS, symbol: 'A\u0007B', name: 'N'.repeat(200), decimals: '18', type: 'ERC-20', exchange_rate: '0', reputation: 'ok' },
      value: '1000000000000000000',
    }
    const bad = [
      { token: { ...good.token, address_hash: 'nope' }, value: '1' },
      { token: { ...good.token, decimals: '99' }, value: '1' },
      { token: { ...good.token }, value: '-5' },
      { token: null, value: '1' },
    ]
    const tokens = parseTokenBalances([good, ...bad])
    expect(tokens).toHaveLength(1)
    expect(tokens[0].symbol).toBe('AB')
    expect(tokens[0].name).toHaveLength(64)
    expect(tokens[0].priceUsd).toBeNull() // a zero price is unpriced
    expect(() => parseTokenBalances({ nope: true })).toThrow(ProviderError)
  })
})

describe('blockscout adapter', () => {
  it('scans Ethereum keyless, without sending any key', async () => {
    const urls: string[] = []
    const headers: Array<Record<string, string> | undefined> = []
    const fetchFn = (async (url: string, init: RequestInit) => {
      urls.push(url)
      headers.push(init.headers as Record<string, string>)
      return json(fixture('blockscout-eth-token-balances.json'))
    }) as unknown as typeof fetch

    const bs = createBlockscout({ fetch: fetchFn })
    expect(await bs.listTokens('eth', EVM)).toHaveLength(3)
    expect(urls).toEqual([`https://eth.blockscout.com/api/v2/addresses/${EVM}/token-balances`])
    expect(headers[0]?.Authorization).toBeUndefined()
  })

  it('only supports Ethereum, the other chains use the known-token scan', async () => {
    const bs = createBlockscout()
    expect(bs.support('eth')).toEqual({ enabled: true })
    expect(bs.support('base').enabled).toBe(false)
    expect(bs.support('bsc').enabled).toBe(false)
    await expect(bs.listTokens('base', EVM)).rejects.toThrow(ProviderError)
  })
})

describe('known-token scan (Base and BNB Chain)', () => {
  const USDC_BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
  const USDT_BSC = '0x55d398326f99059ff775485246999027b3197955'
  const WETH_BASE = '0x4200000000000000000000000000000000000006'

  interface Calls { balances: Array<{ chain: string; tokens: number }>; priced: string[][] }

  function build(opts: { held: Record<string, string>; failing?: string[]; priceDown?: boolean; priced?: Record<string, string> }) {
    const calls: Calls = { balances: [], priced: [] }
    const evm: EvmProvider = {
      getBalances: async (chain, _address, tokens) => {
        calls.balances.push({ chain, tokens: tokens.length })
        const out: Record<string, TokenBalance> = {}
        for (const t of tokens) {
          if (opts.failing?.includes(t.contract)) out[t.contract] = { ok: false, error: new ProviderError('evm-rpc', 'rpc', 'boom') }
          else out[t.contract] = { ok: true, balance: dec(opts.held[t.contract] ?? '0') }
        }
        return { native: dec(0), tokens: out }
      },
      getTokenMetadata: async () => {
        throw new Error('not used')
      },
    }
    const prices: PriceProvider = {
      getNativePrices: async () => ({ btc: dec(1), eth: dec(1) }),
      getTokenPrices: async (_chain, contracts) => {
        calls.priced.push(contracts)
        if (opts.priceDown) throw new ProviderError('coingecko', 'http', 'HTTP 429')
        return new Map(Object.entries(opts.priced ?? {}).filter(([c]) => contracts.includes(c)).map(([c, v]) => [c, dec(v)]))
      },
    }
    const ethereum: ScanProvider = { support: () => ({ enabled: true }), listTokens: async () => [] }
    return { scan: createScanProvider({ evm, prices, ethereum }), calls }
  }

  it('reports only held tokens, with the known symbol and decimals, in one batched read', async () => {
    const { scan, calls } = build({ held: { [USDC_BASE]: '25.5', [WETH_BASE]: '0.1' }, priced: { [USDC_BASE]: '0.9996', [WETH_BASE]: '3000' } })
    const found = await scan.listTokens('base', EVM)

    expect(found.map((t) => [t.symbol, t.balance.toString(), t.priceUsd?.toString()]).sort()).toEqual([
      ['USDC', '25.5', '0.9996'],
      ['WETH', '0.1', '3000'],
    ])
    expect(calls.balances).toHaveLength(1) // every known token in a single batch
    expect(calls.balances[0].tokens).toBeGreaterThan(5)
    expect(calls.priced).toHaveLength(1)
    expect(calls.priced[0].sort()).toEqual([WETH_BASE, USDC_BASE]) // only the held ones are priced (sorted: 0x42… before 0x83…)
  })

  it('scans Arbitrum with its own contracts and 6-decimal USDC', async () => {
    const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
    const { scan, calls } = build({ held: { [USDC_ARB]: '40' }, priced: { [USDC_ARB]: '0.9999' } })
    expect(scan.support('arb')).toEqual({ enabled: true })

    const found = await scan.listTokens('arb', EVM)
    expect(found.map((t) => [t.symbol, t.decimals, t.balance.toString(), t.priceUsd?.toString()])).toEqual([['USDC', 6, '40', '0.9999']])
    expect(calls.balances[0]).toEqual({ chain: 'arb', tokens: KNOWN_TOKENS.arb!.length })
  })

  it("uses each chain's own decimals (USDT is 18 on BNB Chain)", () => {
    const usdt = KNOWN_TOKENS.bsc!.find((t) => t.symbol === 'USDT')!
    const usdc = KNOWN_TOKENS.base!.find((t) => t.symbol === 'USDC')!
    expect(usdt.decimals).toBe(18)
    expect(usdc.decimals).toBe(6)
  })

  it('has no duplicate contracts and only valid addresses in either list', () => {
    for (const list of Object.values(KNOWN_TOKENS)) {
      const lower = list!.map((t) => t.contract.toLowerCase())
      expect(new Set(lower).size).toBe(lower.length)
      for (const c of lower) expect(c).toMatch(/^0x[0-9a-f]{40}$/)
    }
  })

  it('returns nothing and skips the price call for an empty wallet', async () => {
    const { scan, calls } = build({ held: {} })
    expect(await scan.listTokens('bsc', EVM)).toEqual([])
    expect(calls.priced).toHaveLength(0)
  })

  it('leaves tokens unpriced when the price source is down, instead of failing the scan', async () => {
    const { scan } = build({ held: { [USDT_BSC]: '12' }, priceDown: true })
    const [t] = await scan.listTokens('bsc', EVM)
    expect(t.symbol).toBe('USDT')
    expect(t.balance.toString()).toBe('12')
    expect(t.priceUsd).toBeNull()
    expect(scan.pricesUnavailable?.('bsc', EVM)).toBe(true) // so the dialog says "lookup failed", not "worthless"
  })

  it('clears the price-failure flag on the next scan that gets prices', async () => {
    const { scan } = build({ held: { [USDT_BSC]: '12' }, priced: { [USDT_BSC]: '1' } })
    await scan.listTokens('bsc', EVM)
    expect(scan.pricesUnavailable?.('bsc', EVM)).toBe(false)
  })

  it('skips a token whose balance read failed rather than reporting it as empty', async () => {
    const { scan } = build({ held: { [USDC_BASE]: '5', [WETH_BASE]: '1' }, failing: [WETH_BASE] })
    expect((await scan.listTokens('base', EVM)).map((t) => t.symbol)).toEqual(['USDC'])
  })

  it('routes Ethereum to Blockscout and the other chains to the known-token list', async () => {
    const { scan } = build({ held: {} })
    expect(scan.support('eth')).toEqual({ enabled: true })
    expect(scan.support('base')).toEqual({ enabled: true })
    expect(scan.support('bsc')).toEqual({ enabled: true })
  })
})

describe('token scan route', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let tokens: ScanToken[]
  let provider: ScanProvider & { calls: number }

  beforeAll(async () => {
    provider = {
      calls: 0,
      support: (chain) => (chain === 'base' ? { enabled: false, reason: 'Base scan is disabled: set BLOCKSCOUT_API_KEY' } : { enabled: true }),
      listTokens: async () => {
        provider.calls++
        return tokens
      },
    }
  })

  beforeEach(async () => {
    // A fresh app per test gives each test its own rate-limit counters (login 10/min, scan 10/min).
    app = await buildApp({ adminCrypto: { scan: provider } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }

    tokens = parseTokenBalances(fixture('blockscout-eth-token-balances.json'))
    provider.calls = 0
    provider.listTokens = async () => {
      provider.calls++
      return tokens
    }
    await query('DELETE FROM "CryptoAddress"')
    await query('DELETE FROM "IgnoredToken"')
    await query('DELETE FROM "Setting"')
  })

  afterEach(async () => {
    await app.close()
  })

  afterAll(async () => {
    await pool.end()
  })

  const call =(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, authed = true) =>
    app.inject({ method, url: `/api/admin/crypto${url}`, payload, cookies: authed ? cookies : {} })

  const addAddress = async (chain: string, address: string) => (await call('POST', '/addresses', { chain, address })).json().id as string

  it('requires a session on the new routes (SC1)', async () => {
    const id = await addAddress('eth', EVM)
    for (const [method, url, payload] of [
      ['POST', `/addresses/${id}/scan`],
      ['GET', '/settings'],
      ['PUT', '/settings', { scanThresholdUsd: '5' }],
      ['GET', '/ignored-tokens'],
      ['POST', '/ignored-tokens', { chain: 'eth', contractAddress: ENS }],
      ['DELETE', '/ignored-tokens/x'],
    ] as const) {
      expect([method, url, (await call(method, url, payload, false)).statusCode]).toEqual([method, url, 401])
    }
    expect(provider.calls).toBe(0)
  })

  it('splits tokens into selectable, unpriced and hidden with the default $10 threshold (SC4)', async () => {
    const id = await addAddress('eth', EVM)
    const res = await call('POST', `/addresses/${id}/scan`)
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.status).toBe('ok')
    expect(body.thresholdUsd).toBe('10')
    // WHITE 327400 first, then ENS 4518.94250045 (sorted by value)
    expect(body.selectable.map((t: { symbol: string }) => t.symbol)).toEqual(['WHITE', 'ENS'])
    expect(body.selectable[1]).toMatchObject({
      contract: ENS,
      balance: '1144.036076063671431479',
      priceUsd: '3.95',
      valueUsd: '4518.94250045',
      tracked: false,
    })
    expect(body.unpriced.map((t: { contract: string }) => t.contract)).toEqual([NOT])
    expect(body.unpriced[0].valueUsd).toBeNull()
    expect(body.hidden).toEqual([])
  })

  it('applies a changed threshold on the next scan and counts what falls below', async () => {
    const id = await addAddress('eth', EVM)
    expect((await call('GET', '/settings')).json()).toEqual({ scanThresholdUsd: '10' })
    expect((await call('PUT', '/settings', { scanThresholdUsd: '5000' })).json()).toEqual({ scanThresholdUsd: '5000' })

    const body = (await call('POST', `/addresses/${id}/scan`)).json()
    expect(body.thresholdUsd).toBe('5000')
    expect(body.selectable.map((t: { symbol: string }) => t.symbol)).toEqual(['WHITE'])
    expect(body.belowThresholdCount).toBe(1) // ENS at 4518.94
  })

  it('includes a token worth exactly the threshold', async () => {
    const id = await addAddress('eth', EVM)
    tokens = tokens.filter((t) => t.contract === ENS)
    await call('PUT', '/settings', { scanThresholdUsd: '4518.94' })
    expect((await call('POST', `/addresses/${id}/scan`)).json().selectable).toHaveLength(1)
    await call('PUT', '/settings', { scanThresholdUsd: '4518.95' })
    expect((await call('POST', `/addresses/${id}/scan`)).json().selectable).toHaveLength(0)
  })

  it('rejects an invalid threshold', async () => {
    for (const bad of ['-1', 'abc', '1e3', '1.234', '', '99999999999']) {
      expect([bad, (await call('PUT', '/settings', { scanThresholdUsd: bad })).statusCode]).toEqual([bad, 400])
    }
    expect((await call('PUT', '/settings', { scanThresholdUsd: '5', extra: 1 })).statusCode).toBe(400)
    expect((await call('GET', '/settings')).json()).toEqual({ scanThresholdUsd: '10' })
  })

  it('hides ignored tokens from every later scan, and shows them again when un-ignored (SC4)', async () => {
    const id = await addAddress('eth', EVM)
    const ignored = await call('POST', '/ignored-tokens', { chain: 'eth', contractAddress: WHITE.toUpperCase().replace('0X', '0x') })
    expect(ignored.statusCode).toBe(201)
    expect(ignored.json()).toMatchObject({ chain: 'eth', contractAddress: WHITE })
    expect((await call('POST', '/ignored-tokens', { chain: 'eth', contractAddress: WHITE })).json().id).toBe(ignored.json().id) // idempotent

    for (let i = 0; i < 2; i++) {
      const body = (await call('POST', `/addresses/${id}/scan`)).json()
      expect(body.selectable.map((t: { symbol: string }) => t.symbol)).toEqual(['ENS'])
      expect(body.hidden).toMatchObject([{ symbol: 'WHITE', hiddenReason: 'ignored' }])
    }

    expect((await call('GET', '/ignored-tokens')).json().ignored).toHaveLength(1)
    expect((await call('DELETE', `/ignored-tokens/${ignored.json().id}`)).statusCode).toBe(204)
    expect((await call('DELETE', `/ignored-tokens/${ignored.json().id}`)).statusCode).toBe(404)
    expect((await call('POST', `/addresses/${id}/scan`)).json().selectable.map((t: { symbol: string }) => t.symbol)).toEqual(['WHITE', 'ENS'])
  })

  it('ignoring on one chain does not hide the same contract on the other', async () => {
    const eth = await addAddress('eth', EVM)
    await call('POST', '/ignored-tokens', { chain: 'base', contractAddress: ENS })
    expect((await call('POST', `/addresses/${eth}/scan`)).json().hidden).toEqual([])
  })

  it('hides provider-flagged spam and skips zero balances', async () => {
    const id = await addAddress('eth', EVM)
    tokens = tokens.map((t) => (t.contract === ENS ? { ...t, reputation: 'scam' } : t))
    tokens.push({ ...tokens[0], contract: '0x' + '5'.repeat(40), symbol: 'ZERO', balance: tokens[0].balance.mul(0), reputation: 'ok' })
    const body = (await call('POST', `/addresses/${id}/scan`)).json()
    expect(body.hidden).toMatchObject([{ symbol: 'ENS', hiddenReason: 'spam' }])
    expect([...body.selectable, ...body.unpriced].map((t: { symbol: string }) => t.symbol)).not.toContain('ZERO')
  })

  it('marks tokens that are already tracked on the address', async () => {
    const id = await addAddress('eth', EVM)
    await query(
      `INSERT INTO "CryptoAsset" ("id", "addressId", "kind", "symbol", "contractAddress", "decimals") VALUES ('as_t', $1, 'token', 'ENS', $2, 18)`,
      [id, ENS]
    )
    const body = (await call('POST', `/addresses/${id}/scan`)).json()
    expect(body.selectable.find((t: { contract: string }) => t.contract === ENS).tracked).toBe(true)
    expect(body.selectable.find((t: { contract: string }) => t.contract === WHITE).tracked).toBe(false)
  })

  it('returns an empty scan for BTC without calling the provider', async () => {
    const id = await addAddress('btc', BTC)
    const body = (await call('POST', `/addresses/${id}/scan`)).json()
    expect(body).toMatchObject({ status: 'ok', selectable: [], unpriced: [], hidden: [] })
    expect(provider.calls).toBe(0)
  })

  it('says so when the Base scan is disabled, instead of failing', async () => {
    const id = await addAddress('base', EVM)
    const res = await call('POST', `/addresses/${id}/scan`)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'disabled', reason: expect.stringContaining('BLOCKSCOUT_API_KEY') })
    expect(provider.calls).toBe(0)
  })

  it('returns 404 for an unknown address and 502 when the provider fails', async () => {
    expect((await call('POST', '/addresses/nope/scan')).statusCode).toBe(404)
    const id = await addAddress('eth', EVM)
    provider.listTokens = async () => {
      throw new ProviderError('blockscout', 'timeout', 'no answer within 60000 ms')
    }
    const res = await call('POST', `/addresses/${id}/scan`)
    expect(res.statusCode).toBe(502)
    expect(res.json().error).toContain('no answer within 60000 ms')
  })

  it('rate limits scans, since each one calls an external service', async () => {
    const id = await addAddress('eth', EVM)
    const codes: number[] = []
    for (let i = 0; i < 11; i++) codes.push((await call('POST', `/addresses/${id}/scan`)).statusCode)
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true)
    expect(codes[10]).toBe(429)
    expect(provider.calls).toBe(10)
  })

  it('validates ignored-token input', async () => {
    for (const payload of [
      { chain: 'btc', contractAddress: ENS },
      { chain: 'eth', contractAddress: '0x123' },
      { chain: 'eth' },
      { chain: 'eth', contractAddress: ENS, extra: 1 },
    ]) {
      expect([JSON.stringify(payload), (await call('POST', '/ignored-tokens', payload)).statusCode]).toEqual([JSON.stringify(payload), 400])
    }
  })
})
