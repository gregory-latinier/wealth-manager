import { FastifyInstance } from 'fastify'
import { buildApp } from '../../index'
import { pool, query } from '../../db/index'
import { SESSION_COOKIE } from '../../lib/auth'
import { dec } from '../../lib/money'
import { runSnapshot } from '../../lib/snapshot'
import type { FxProvider } from '../fx/frankfurter'
import { createCryptoSource, nativeRef, tokenRef, type CryptoProviders } from './index'
import { ProviderError, type SolTokenPriceProvider, type SolTokenProvider, type SplBalance } from './providers/types'

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const fx: FxProvider = { getUsdPerEur: async () => ({ usdPerEur: dec('1.25'), date: '2026-11-19' }) }

interface Setup {
  held?: SplBalance[] | Error
  prices?: Record<string, { price: string; symbol: string }> | Error
  decimals?: Record<string, number>
  solPrice?: string
}

function build(opts: Setup) {
  const tokens: SolTokenProvider = {
    getTokenBalances: async () => {
      if (opts.held instanceof Error) throw opts.held
      return opts.held ?? []
    },
    getMintDecimals: async (mint) => {
      const d = opts.decimals?.[mint]
      if (d === undefined) throw new ProviderError('solana-rpc', 'rpc', 'getTokenSupply: Invalid param: not a Token mint')
      return d
    },
  }
  const splPrices: SolTokenPriceProvider = {
    getSplPrices: async (mints) => {
      if (opts.prices instanceof Error) throw opts.prices
      const known = opts.prices ?? {}
      return new Map(mints.filter((m) => known[m]).map((m) => [m, { priceUsd: dec(known[m].price), symbol: known[m].symbol }]))
    },
  }
  const providers: CryptoProviders = {
    btc: { getBalance: async () => dec(0) },
    evm: { getBalances: async () => ({ native: dec(0), tokens: {} }), getTokenMetadata: async () => ({ symbol: 'X', decimals: 18 }) },
    sol: { getBalance: async () => dec('2'), ...tokens },
    splPrices,
    prices: {
      getNativePrices: async () => ({ btc: dec('60000'), eth: dec('2000'), ...(opts.solPrice ? { sol: dec(opts.solPrice) } : {}) }),
      getTokenPrices: async () => new Map(),
    },
  }
  return { providers, tokens, splPrices }
}

describe('Solana tokens', () => {
  let app: FastifyInstance
  let cookies: Record<string, string>

  const setup = async (opts: Setup) => {
    const built = build(opts)
    app = await buildApp({ adminCrypto: { evm: built.providers.evm, prices: built.providers.prices, solana: built.tokens, splPrices: built.splPrices } })
    await app.ready()
    await query('DELETE FROM "Session"')
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { password: 'correct-horse-battery' } })
    cookies = { [SESSION_COOKIE]: login.cookies.find((c) => c.name === SESSION_COOKIE)!.value }
    return built.providers
  }

  const call = (method: 'GET' | 'POST', url: string, payload?: object, authed = true) =>
    app.inject({ method, url: `/api/admin/crypto${url}`, payload, cookies: authed ? cookies : {} })
  const addAddress = async () => (await call('POST', '/addresses', { chain: 'sol', address: WALLET })).json().id as string
  const addToken = (id: string, contractAddress: string) => call('POST', `/addresses/${id}/tokens`, { contractAddress })

  beforeEach(async () => {
    // The ignore list is global, not per address: without this one test's ignored mint would hide it from the next test's scan.
    await query('DELETE FROM "IgnoredToken"')
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

  describe('adding a token', () => {
    it('keeps the case of the mint, reads decimals from the mint and the symbol from the price provider', async () => {
      await setup({ decimals: { [USDC]: 6 }, prices: { [USDC]: { price: '0.9999', symbol: 'USDC' } } })
      const id = await addAddress()
      const res = await addToken(id, USDC)
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ contractAddress: USDC, symbol: 'USDC', decimals: 6, priced: true, warning: null })
      const stored = await query<{ contractAddress: string }>(`SELECT "contractAddress" FROM "CryptoAsset" WHERE "kind" = 'token'`)
      expect(stored.rows[0].contractAddress).toBe(USDC) // not lowercased
    })

    it('treats mints that differ only by case as two tokens', async () => {
      // A second valid 32 byte key that differs from USDC by the case of its second letter (found by trying each letter: most
      // single-letter changes decode to another length and are not keys at all). Anything that lowercased a mint would confuse them.
      const twin = 'EpjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
      expect(twin).not.toBe(USDC)
      expect(twin.toLowerCase()).toBe(USDC.toLowerCase()) // identical once folded: the exact trap
      await setup({ decimals: { [USDC]: 6, [twin]: 6 }, prices: {} })
      const id = await addAddress()
      expect((await addToken(id, USDC)).statusCode).toBe(201)
      expect((await addToken(id, twin)).statusCode).toBe(201) // not mistaken for the first
      expect((await addToken(id, USDC)).statusCode).toBe(409) // the same one twice is
      const stored = await query<{ contractAddress: string }>(`SELECT "contractAddress" FROM "CryptoAsset" WHERE "kind" = 'token' ORDER BY "contractAddress"`)
      expect(stored.rows.map((r) => r.contractAddress).sort()).toEqual([USDC, twin].sort())
    })

    it('rejects a mint written in lowercase when that is not a valid key, instead of silently folding it', async () => {
      await setup({ decimals: { [USDC]: 6 } })
      expect((await addToken(await addAddress(), USDC.toLowerCase())).statusCode).toBe(400)
    })

    it('rejects a wallet address pasted as a mint, and an invalid string', async () => {
      await setup({ decimals: { [USDC]: 6 } })
      const id = await addAddress()
      const wallet = await addToken(id, WALLET)
      expect(wallet.statusCode).toBe(502) // the chain says it is not a mint
      expect((await addToken(id, 'not-a-mint')).statusCode).toBe(400)
      expect((await addToken(id, '0x' + 'a'.repeat(40))).statusCode).toBe(400) // an EVM contract is not a mint
    })

    it('warns, accurately, when the mint has no price, and falls back to a short symbol', async () => {
      await setup({ decimals: { [JUP]: 6 }, prices: {} })
      const res = await addToken(await addAddress(), JUP)
      expect(res.statusCode).toBe(201)
      expect(res.json().priced).toBe(false)
      expect(res.json().symbol).toBe(`${JUP.slice(0, 4)}…${JUP.slice(-4)}`)
      expect(res.json().warning).toContain('carried forward')
    })

    it('still adds the token when the price check fails, with priced unknown', async () => {
      await setup({ decimals: { [USDC]: 6 }, prices: new ProviderError('defillama', 'http', 'HTTP 429') })
      const res = await addToken(await addAddress(), USDC)
      expect(res.statusCode).toBe(201)
      expect(res.json().priced).toBeNull()
    })

    it('requires a session', async () => {
      await setup({ decimals: { [USDC]: 6 } })
      const id = await addAddress()
      expect((await call('POST', `/addresses/${id}/tokens`, { contractAddress: USDC }, false)).statusCode).toBe(401)
    })
  })

  describe('valuation in the crypto source', () => {
    it('values SOL and a tracked token together, with exact decimals', async () => {
      const providers = await setup({
        held: [{ mint: USDC, decimals: 6, balance: dec('81.809468') }],
        decimals: { [USDC]: 6 },
        prices: { [USDC]: { price: '0.999621', symbol: 'USDC' } },
        solPrice: '70',
      })
      await addToken(await addAddress(), USDC)

      const { lines, failures } = await createCryptoSource(providers).collect({ date: '2026-11-19' })
      expect(failures).toEqual([])
      // Sorted by sourceRef, so the token ("EPjF…") comes before "native".
      expect(lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([
        [tokenRef('sol', WALLET, USDC), 'USDC', '81.809468', '0.999621'],
        [nativeRef('sol', WALLET), 'SOL', '2', '70'],
      ])
      // 2 * 70 + 81.809468 * 0.999621 (= 81.77846221) = 221.77846221 USD, / 1.25 = 177.42276977 EUR
      const summary = await runSnapshot({ sources: [createCryptoSource(providers)], fx, now: new Date('2026-11-19T12:00:00Z') })
      expect(summary).toMatchObject({ status: 'complete', totalUsd: '221.77846221', totalEur: '177.42276977', lineCount: 2 })
    })

    it('values a token the wallet no longer holds at zero: a closed token account is a real empty balance', async () => {
      const providers = await setup({ held: [], decimals: { [USDC]: 6 }, prices: { [USDC]: { price: '1', symbol: 'USDC' } }, solPrice: '70' })
      await addToken(await addAddress(), USDC)
      const { lines, failures } = await createCryptoSource(providers).collect({ date: '2026-11-19' })
      expect(failures).toEqual([])
      expect(lines.find((l) => l.symbol === 'USDC')!.amount.toString()).toBe('0')
    })

    it('reports a token without a price as a failure, never as a zero value that would drop it from the net worth', async () => {
      const providers = await setup({ held: [{ mint: JUP, decimals: 6, balance: dec('500') }], decimals: { [JUP]: 6 }, prices: {}, solPrice: '70' })
      await addToken(await addAddress(), JUP)
      const { lines, failures } = await createCryptoSource(providers).collect({ date: '2026-11-19' })
      expect(lines.map((l) => l.symbol)).toEqual(['SOL']) // the SOL is still valued
      expect(failures.map((f) => f.sourceRef)).toEqual([tokenRef('sol', WALLET, JUP)])
      expect(failures[0].reason).toContain('no USD price')
    })

    it('values an unpriced token at 0 when its balance is empty, so it does not keep the snapshot partial', async () => {
      const providers = await setup({ held: [], decimals: { [JUP]: 6 }, prices: {}, solPrice: '70' })
      await addToken(await addAddress(), JUP)
      const { lines, failures } = await createCryptoSource(providers).collect({ date: '2026-11-19' })
      expect(failures).toEqual([])
      expect(lines.map((l) => l.symbol).sort()).toEqual([`${JUP.slice(0, 4)}…${JUP.slice(-4)}`, 'SOL'].sort())
    })

    it('fails the tokens alone, keeping the SOL, when the wallet token read fails', async () => {
      const providers = await setup({ held: new ProviderError('solana-rpc', 'http', 'HTTP 429'), decimals: { [USDC]: 6 }, prices: { [USDC]: { price: '1', symbol: 'USDC' } }, solPrice: '70' })
      await addToken(await addAddress(), USDC)
      const { lines, failures } = await createCryptoSource(providers).collect({ date: '2026-11-19' })
      expect(lines.map((l) => l.symbol)).toEqual(['SOL'])
      expect(failures.map((f) => f.sourceRef)).toEqual([tokenRef('sol', WALLET, USDC)])
      expect(failures[0].reason).toContain('HTTP 429')
    })

    it('fails the tokens alone, keeping the SOL, when the price lookup fails', async () => {
      const providers = await setup({
        held: [{ mint: USDC, decimals: 6, balance: dec('5') }],
        decimals: { [USDC]: 6 },
        prices: { [USDC]: { price: '1', symbol: 'USDC' } },
        solPrice: '70',
      })
      await addToken(await addAddress(), USDC)
      providers.splPrices = { getSplPrices: async () => { throw new ProviderError('defillama', 'http', 'HTTP 500') } }
      const { lines, failures } = await createCryptoSource(providers).collect({ date: '2026-11-19' })
      expect(lines.map((l) => l.symbol)).toEqual(['SOL'])
      expect(failures[0].reason).toContain('price lookup failed')
    })
  })

  describe('ignoring a token', () => {
    const ignore = (chain: string, contractAddress: string) => call('POST', '/ignored-tokens', { chain, contractAddress })

    it('ignores a Solana mint without lowercasing it, and hides it from the next scan', async () => {
      await setup({ held: [{ mint: JUP, decimals: 6, balance: dec('3') }], prices: { [JUP]: { price: '100', symbol: 'JUP' } } })
      const id = await addAddress()
      const res = await ignore('sol', JUP)
      expect(res.statusCode).toBe(201)
      expect(res.json()).toMatchObject({ chain: 'sol', contractAddress: JUP })

      const scan = (await call('POST', `/addresses/${id}/scan`)).json()
      expect(scan.selectable).toEqual([])
      expect(scan.hidden.map((t: { contract: string; hiddenReason: string }) => [t.contract, t.hiddenReason])).toEqual([[JUP, 'ignored']])
    })

    it('rejects an invalid mint and Bitcoin', async () => {
      await setup({})
      expect((await ignore('sol', 'nope')).statusCode).toBe(400)
      expect((await ignore('sol', '0x' + 'a'.repeat(40))).statusCode).toBe(400)
      expect((await ignore('btc', JUP)).statusCode).toBe(400)
    })
  })

  describe('scan route', () => {
    it('lists the tokens of the wallet and hides nothing silently', async () => {
      await setup({
        held: [
          { mint: USDC, decimals: 6, balance: dec('250') },
          { mint: JUP, decimals: 6, balance: dec('3') },
        ],
        prices: { [USDC]: { price: '1', symbol: 'USDC' } },
      })
      const id = await addAddress()
      const res = await call('POST', `/addresses/${id}/scan`)
      expect(res.statusCode).toBe(200)
      const body = res.json()
      expect(body.status).toBe('ok')
      expect(body.selectable.map((t: { contract: string }) => t.contract)).toEqual([USDC]) // priced and above the $10 threshold
      expect(body.unpriced.map((t: { contract: string }) => t.contract)).toEqual([JUP]) // listed apart, not preselected
    })
  })
})
