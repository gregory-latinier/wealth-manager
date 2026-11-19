import { FastifyInstance } from 'fastify'
import { buildApp } from '../../index'
import { pool, query } from '../../db/index'
import { SESSION_COOKIE } from '../../lib/auth'
import { dec } from '../../lib/money'
import { runSnapshot } from '../../lib/snapshot'
import type { FxProvider } from '../fx/frankfurter'
import { createCryptoSource, nativeRef, tokenRef, type CryptoProviders } from './index'
import { ProviderError, type BtcProvider, type EvmProvider, type PriceProvider, type TokenBalance } from './providers/types'

const EVM = '0xabcdef0123456789abcdef0123456789abcdef01'
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const OBSCURE = '0x' + '7'.repeat(40)
const BTC = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'

const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }

interface Chain {
  native: string
  tokens: Record<string, string | Error>
}

/** Fake providers. `known` lists the contracts the price provider knows, with their USD price. */
function fakes(opts: {
  evm?: Record<string, Chain | Error>
  known?: Record<string, string>
  prices?: Error
  metadata?: Record<string, { symbol: string; decimals: number } | Error>
}) {
  const btc: BtcProvider = { getBalance: async () => dec('0') }
  const evm: EvmProvider = {
    getBalances: async (chain, address, tokens) => {
      const c = opts.evm?.[`${chain}:${address}`]
      if (!c) throw new Error(`unexpected ${chain}:${address}`)
      if (c instanceof Error) throw c
      const out: Record<string, TokenBalance> = {}
      for (const t of tokens) {
        const v = c.tokens[t.contract]
        out[t.contract] = v instanceof Error ? { ok: false, error: v as ProviderError } : { ok: true, balance: dec(v ?? '0') }
      }
      return { native: dec(c.native), tokens: out }
    },
    getTokenMetadata: async (_chain, contract) => {
      const m = opts.metadata?.[contract]
      if (!m) throw new ProviderError('evm-rpc', 'rpc', 'execution reverted')
      if (m instanceof Error) throw m
      return m
    },
  }
  const prices: PriceProvider = {
    getNativePrices: async () => {
      if (opts.prices) throw opts.prices
      return { btc: dec('60000'), eth: dec('2000') }
    },
    getTokenPrices: async (_chain, contracts) => {
      if (opts.prices) throw opts.prices
      return new Map(contracts.filter((c) => opts.known?.[c]).map((c) => [c, dec(opts.known![c])]))
    },
  }
  return { btc, evm, prices } satisfies CryptoProviders
}

describe('tracked tokens', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>
  let providers: CryptoProviders

  const setup = async (p: CryptoProviders) => {
    providers = p
    app = await buildApp({ adminCrypto: { evm: p.evm, prices: p.prices } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
  }

  beforeEach(async () => {
    await query('DELETE FROM "CryptoAddress"')
    await query('DELETE FROM "SnapshotLine"')
    await query('DELETE FROM "Snapshot"')
  })

  afterEach(async () => {
    await app?.close()
  })

  afterAll(async () => {
    await pool.end()
  })

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object, authed = true) =>
    app.inject({ method, url: `/api/admin/crypto${url}`, payload, cookies: authed ? cookies : {} })

  const addAddress = async (chain: string, address: string) => (await call('POST', '/addresses', { chain, address })).json().id as string
  const addToken = (id: string, contractAddress: string) => call('POST', `/addresses/${id}/tokens`, { contractAddress })

  it('requires a session on every token route (SC1)', async () => {
    await setup(fakes({ metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } }, known: { [USDC]: '1' } }))
    const id = await addAddress('base', EVM)
    const token = (await addToken(id, USDC)).json()
    for (const [method, url, payload] of [
      ['GET', `/addresses/${id}/tokens`],
      ['POST', `/addresses/${id}/tokens`, { contractAddress: USDC }],
      ['PATCH', `/addresses/${id}/tokens/${token.id}`, { active: false }],
      ['DELETE', `/addresses/${id}/tokens/${token.id}`],
    ] as const) {
      expect([method, (await call(method, url, payload, false)).statusCode]).toEqual([method, 401])
    }
    expect((await query('SELECT 1 FROM "CryptoAsset" WHERE "kind" = \'token\'')).rowCount).toBe(1)
  })

  it('adds a token by contract, reading symbol and decimals from the chain (SC5)', async () => {
    await setup(fakes({ metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } }, known: { [USDC]: '0.999621' } }))
    const id = await addAddress('base', EVM)
    // Mixed-case input is normalised, and a client cannot supply its own symbol or decimals
    const res = await addToken(id, USDC.toUpperCase().replace('0X', '0x'))
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ symbol: 'USDC', decimals: 6, contractAddress: USDC, active: true, priced: true, warning: null })
    expect((await call('POST', `/addresses/${id}/tokens`, { contractAddress: USDC, symbol: 'EVIL', decimals: 1 })).statusCode).toBe(400)

    const list = (await call('GET', `/addresses/${id}/tokens`)).json().tokens
    expect(list).toHaveLength(1)
  })

  it('accepts an unpriced contract with a visible warning (SC5)', async () => {
    await setup(fakes({ metadata: { [OBSCURE]: { symbol: 'OBS', decimals: 9 } }, known: {} }))
    const id = await addAddress('eth', EVM)
    const res = await addToken(id, OBSCURE)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ symbol: 'OBS', priced: false })
    expect(res.json().warning).toContain('No price is known')
  })

  it('still adds the token when only the price check fails, with priced unknown', async () => {
    await setup(fakes({ metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } }, prices: new ProviderError('coingecko', 'http', 'HTTP 429') }))
    const id = await addAddress('eth', EVM)
    const res = await addToken(id, USDC)
    expect(res.statusCode).toBe(201)
    expect(res.json()).toMatchObject({ priced: null, warning: null })
  })

  it('rejects bad input: BTC address, malformed contract, duplicate, unknown address, non-token contract', async () => {
    await setup(fakes({ metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } }, known: { [USDC]: '1' } }))
    const btc = await addAddress('btc', BTC)
    const eth = await addAddress('eth', EVM)

    expect((await addToken(btc, USDC)).statusCode).toBe(400)
    expect((await addToken(eth, '0x123')).statusCode).toBe(400)
    expect((await addToken('nope', USDC)).statusCode).toBe(404)
    expect((await addToken(eth, OBSCURE)).statusCode).toBe(502) // not a token: symbol()/decimals() revert
    expect((await addToken(eth, USDC)).statusCode).toBe(201)
    expect((await addToken(eth, USDC)).statusCode).toBe(409)
    expect((await query('SELECT 1 FROM "CryptoAsset" WHERE "kind" = \'token\'')).rowCount).toBe(1)
  })

  it('pauses, resumes and deletes a token, and 404s on someone else’s token', async () => {
    await setup(fakes({ metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } }, known: { [USDC]: '1' } }))
    const a = await addAddress('eth', EVM)
    const b = await addAddress('base', EVM)
    const token = (await addToken(a, USDC)).json()

    expect((await call('PATCH', `/addresses/${a}/tokens/${token.id}`, { active: false })).json().active).toBe(false)
    expect((await call('PATCH', `/addresses/${a}/tokens/${token.id}`, { active: true })).json().active).toBe(true)
    expect((await call('PATCH', `/addresses/${b}/tokens/${token.id}`, { active: false })).statusCode).toBe(404)
    expect((await call('DELETE', `/addresses/${b}/tokens/${token.id}`)).statusCode).toBe(404)
    expect((await call('DELETE', `/addresses/${a}/tokens/${token.id}`)).statusCode).toBe(204)
    expect((await call('DELETE', `/addresses/${a}/tokens/${token.id}`)).statusCode).toBe(404)
  })

  describe('valuation in the crypto source', () => {
    it('values a tracked token as its own line, with the right totals (SC7)', async () => {
      const p = fakes({
        evm: { [`base:${EVM}`]: { native: '2', tokens: { [USDC]: '81.809468' } } },
        known: { [USDC]: '0.999621' },
        metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } },
      })
      await setup(p)
      const id = await addAddress('base', EVM)
      await addToken(id, USDC)

      const { lines, failures } = await createCryptoSource(p).collect({ date: '2026-11-19' })
      expect(failures).toEqual([])
      expect(lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([
        [tokenRef('base', EVM, USDC), 'USDC', '81.809468', '0.999621'], // sorted by sourceRef, so "0x…" before "native"
        [nativeRef('base', EVM), 'ETH', '2', '2000'],
      ])

      // 2 * 2000 + 81.809468 * 0.999621 (= 81.77846221) = 4081.77846221 USD, / 1.25 = 3265.42276977 EUR
      const summary = await runSnapshot({ sources: [createCryptoSource(p)], fx, now: new Date('2026-11-19T12:00:00Z') })
      expect(summary).toMatchObject({ status: 'complete', totalUsd: '4081.77846221', totalEur: '3265.42276977', lineCount: 2 })
    })

    it('lists each address with its last snapshot value, summing native and tokens (T14)', async () => {
      const p = fakes({
        evm: { [`base:${EVM}`]: { native: '2', tokens: { [USDC]: '81.809468' } } },
        known: { [USDC]: '0.999621' },
        metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } },
      })
      await setup(p)
      const id = await addAddress('base', EVM)
      await addToken(id, USDC)
      const before = (await call('GET', '/addresses')).json().addresses
      expect(before[0].lastValue).toBeNull()

      await runSnapshot({ sources: [createCryptoSource(p)], fx, now: new Date('2026-11-19T12:00:00Z') })
      const [addr] = (await call('GET', '/addresses')).json().addresses
      expect(addr.lastValue).toEqual({ usd: '4081.77846221', eur: '3265.42276977', date: '2026-11-19', stale: false })
    })

    it('values an unpriced token at 0 and keeps the snapshot complete', async () => {
      const p = fakes({
        evm: { [`eth:${EVM}`]: { native: '1', tokens: { [OBSCURE]: '500' } } },
        known: {},
        metadata: { [OBSCURE]: { symbol: 'OBS', decimals: 9 } },
      })
      await setup(p)
      const id = await addAddress('eth', EVM)
      await addToken(id, OBSCURE)

      const { lines } = await createCryptoSource(p).collect({ date: '2026-11-19' })
      const obs = lines.find((l) => l.symbol === 'OBS')!
      expect(obs.priceUsd.toString()).toBe('0')
      expect(obs.amount.toString()).toBe('500')
    })

    it('a failing token is reported alone while the native coin and other tokens are still valued (SC9)', async () => {
      const p = fakes({
        evm: { [`eth:${EVM}`]: { native: '1', tokens: { [USDC]: new ProviderError('evm-rpc', 'rpc', 'execution reverted'), [OBSCURE]: '10' } } },
        known: { [USDC]: '1', [OBSCURE]: '3' },
        metadata: { [USDC]: { symbol: 'USDC', decimals: 6 }, [OBSCURE]: { symbol: 'OBS', decimals: 9 } },
      })
      await setup(p)
      const id = await addAddress('eth', EVM)
      await addToken(id, USDC)
      await addToken(id, OBSCURE)

      const { lines, failures } = await createCryptoSource(p).collect({ date: '2026-11-19' })
      expect(lines.map((l) => l.symbol).sort()).toEqual(['ETH', 'OBS'])
      expect(failures).toEqual([{ sourceRef: tokenRef('eth', EVM, USDC), reason: 'evm-rpc: execution reverted' }])
    })

    it('fails the native coin and every token of an address whose RPC is down', async () => {
      const p = fakes({
        evm: { [`eth:${EVM}`]: new ProviderError('evm-rpc', 'timeout', 'no answer within 15000 ms') },
        metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } },
        known: { [USDC]: '1' },
      })
      await setup(p)
      const id = await addAddress('eth', EVM)
      await addToken(id, USDC)

      const { lines, failures } = await createCryptoSource(p).collect({ date: '2026-11-19' })
      expect(lines).toEqual([])
      expect(failures.map((f) => f.sourceRef).sort()).toEqual([nativeRef('eth', EVM), tokenRef('eth', EVM, USDC)].sort())
    })

    it('fails only the tokens of a chain whose token prices are unavailable', async () => {
      const base = fakes({
        evm: { [`eth:${EVM}`]: { native: '1', tokens: { [USDC]: '5' } } },
        metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } },
        known: { [USDC]: '1' },
      })
      await setup(base)
      const id = await addAddress('eth', EVM)
      await addToken(id, USDC)

      const broken: CryptoProviders = {
        ...base,
        prices: {
          getNativePrices: base.prices.getNativePrices,
          getTokenPrices: async () => {
            throw new ProviderError('coingecko', 'http', 'HTTP 429')
          },
        },
      }
      const { lines, failures } = await createCryptoSource(broken).collect({ date: '2026-11-19' })
      expect(lines.map((l) => l.symbol)).toEqual(['ETH']) // never a token line priced at 0 because of an outage
      expect(failures).toHaveLength(1)
      expect(failures[0].sourceRef).toBe(tokenRef('eth', EVM, USDC))
      expect(failures[0].reason).toContain('price lookup failed')
    })

    it('skips paused tokens and keeps past snapshot lines when a token is paused or deleted (SC6)', async () => {
      const p = fakes({
        evm: { [`eth:${EVM}`]: { native: '1', tokens: { [USDC]: '5' } } },
        metadata: { [USDC]: { symbol: 'USDC', decimals: 6 } },
        known: { [USDC]: '1' },
      })
      await setup(p)
      const id = await addAddress('eth', EVM)
      const token = (await addToken(id, USDC)).json()

      await runSnapshot({ sources: [createCryptoSource(p)], fx, now: new Date('2026-11-19T12:00:00Z') })
      const before = (await query('SELECT * FROM "SnapshotLine" ORDER BY "sourceRef"')).rows
      expect(before).toHaveLength(2)

      await call('PATCH', `/addresses/${id}/tokens/${token.id}`, { active: false })
      expect((await createCryptoSource(p).collect({ date: '2026-11-20' })).lines.map((l) => l.symbol)).toEqual(['ETH'])
      await call('DELETE', `/addresses/${id}/tokens/${token.id}`)
      expect((await query('SELECT * FROM "SnapshotLine" ORDER BY "sourceRef"')).rows).toEqual(before)
    })
  })
})
