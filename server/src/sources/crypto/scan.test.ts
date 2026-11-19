import { readFileSync } from 'fs'
import { join } from 'path'
import { FastifyInstance } from 'fastify'
import { buildApp } from '../../index'
import { pool, query } from '../../db/index'
import { SESSION_COOKIE } from '../../lib/auth'
import { createBlockscout, parseTokenBalances, type ScanProvider, type ScanToken } from './providers/blockscout'
import { ProviderError } from './providers/types'

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
  it('scans Ethereum keyless and Base with the key, following pages', async () => {
    const urls: string[] = []
    const headers: Array<Record<string, string> | undefined> = []
    const page1 = { items: fixture('blockscout-eth-token-balances.json').slice(0, 1), next_page_params: { id: 7, value: '5', fiat_value: null } }
    const page2 = { items: fixture('blockscout-eth-token-balances.json').slice(1, 2), next_page_params: null }
    const pages = [page1, page2]
    const fetchFn = (async (url: string, init: RequestInit) => {
      urls.push(url)
      headers.push(init.headers as Record<string, string>)
      return json(url.includes('eth.blockscout.com') ? fixture('blockscout-eth-token-balances.json') : pages.shift())
    }) as unknown as typeof fetch

    const bs = createBlockscout({ fetch: fetchFn, apiKey: 'proapi_x' })
    expect(await bs.listTokens('eth', EVM)).toHaveLength(3)
    expect(urls[0]).toBe(`https://eth.blockscout.com/api/v2/addresses/${EVM}/token-balances`)
    expect(headers[0]?.Authorization).toBeUndefined() // the key is never sent to the keyless host

    expect((await bs.listTokens('base', EVM)).map((t) => t.symbol)).toEqual(['ENS', 'WHITE'])
    expect(urls[1]).toBe(`https://api.blockscout.com/8453/api/v2/addresses/${EVM}/tokens?type=ERC-20`)
    expect(urls[2]).toBe(`https://api.blockscout.com/8453/api/v2/addresses/${EVM}/tokens?type=ERC-20&id=7&value=5&fiat_value=`)
    expect(headers[1]?.Authorization).toBe('Bearer proapi_x')
  })

  it('reports Base as disabled without a key and Ethereum as enabled', () => {
    const bs = createBlockscout({ apiKey: '' })
    expect(bs.support('eth')).toEqual({ enabled: true })
    const base = bs.support('base')
    expect(base.enabled).toBe(false)
    expect(!base.enabled && base.reason).toContain('BLOCKSCOUT_API_KEY')
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
