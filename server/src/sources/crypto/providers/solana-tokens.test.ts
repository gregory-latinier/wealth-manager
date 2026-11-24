import { dec } from '../../../lib/money'
import { createSolanaScan } from './solana-scan'
import { createSolanaRpc, parseMintDecimals, parseTokenAccounts } from './solana'
import { createSolanaTokenPrices, parseSplPrices } from './solana-prices'
import { ProviderError, type SolTokenPriceProvider, type SolTokenProvider } from './types'

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const SPAM = 'SpamSpamSpamSpamSpamSpamSpamSpamSpamSpam1'
const EMPTY = 'EmptyEmptyEmptyEmptyEmptyEmptyEmptyEmptyEm'
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

const account = (mint: string, amount: string, decimals: number) => ({
  account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals, uiAmount: 1.5 } } } } },
})
const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

describe('parseTokenAccounts', () => {
  it('reads exact amounts from the integer string, not the float', () => {
    const [usdc] = parseTokenAccounts({ result: { value: [account(USDC, '1234567', 6)] } })
    expect(usdc).toMatchObject({ mint: USDC, decimals: 6 })
    expect(usdc.balance.toString()).toBe('1.234567')
  })

  it('sums several accounts of the same mint and keeps the case of the mint', () => {
    const out = parseTokenAccounts({ result: { value: [account(USDC, '1000000', 6), account(USDC, '2000000', 6), account(JUP, '5', 0)] } })
    expect(out.map((b) => [b.mint, b.balance.toString()])).toEqual([
      [USDC, '3'],
      [JUP, '5'],
    ])
  })

  it('skips one malformed account without hiding the others', () => {
    const out = parseTokenAccounts({
      result: { value: [{ account: {} }, account(USDC, 'not a number', 6), account(USDC, '5', 99), account(JUP, '1000000', 6)] },
    })
    expect(out.map((b) => b.mint)).toEqual([JUP])
  })

  it('treats an RPC error or a missing list as a failure, never as an empty wallet', () => {
    expect(() => parseTokenAccounts({ error: { message: 'Too many requests' } })).toThrow(ProviderError)
    expect(() => parseTokenAccounts({ result: { value: 'nope' } })).toThrow(ProviderError)
    expect(() => parseTokenAccounts(null)).toThrow(ProviderError)
  })
})

describe('parseMintDecimals', () => {
  it('reads the decimals of a mint and rejects an address that is not one', () => {
    expect(parseMintDecimals({ result: { value: { decimals: 6 } } })).toBe(6)
    expect(() => parseMintDecimals({ error: { message: 'Invalid param: not a Token mint' } })).toThrow(ProviderError)
    expect(() => parseMintDecimals({ result: { value: { decimals: 99 } } })).toThrow(ProviderError)
  })
})

describe('parseSplPrices', () => {
  it('matches the exact mint, never a case-folded one', () => {
    // The price API answers a lowercased mint with the price of the real one, under the lowercased key. That must not price JUP.
    const lowered = parseSplPrices({ coins: { [`solana:${JUP.toLowerCase()}`]: { price: 0.2, symbol: 'JUP' } } }, [JUP])
    expect(lowered.size).toBe(0)
    const exact = parseSplPrices({ coins: { [`solana:${JUP}`]: { price: 0.2, symbol: 'jup' } } }, [JUP])
    expect(exact.get(JUP)?.priceUsd.toString()).toBe('0.2')
  })

  it('leaves a mint unpriced when the price is missing or zero, and rejects garbage', () => {
    expect(parseSplPrices({ coins: {} }, [JUP]).size).toBe(0)
    expect(parseSplPrices({ coins: { [`solana:${JUP}`]: { price: 0 } } }, [JUP]).size).toBe(0)
    expect(() => parseSplPrices({ coins: { [`solana:${JUP}`]: { price: '1' } } }, [JUP])).toThrow(ProviderError)
    expect(() => parseSplPrices({ coins: { [`solana:${JUP}`]: { price: -1 } } }, [JUP])).toThrow(ProviderError)
    expect(() => parseSplPrices({}, [JUP])).toThrow(ProviderError)
  })

  it('cleans a hostile symbol: no control characters, capped length', () => {
    const symbol = 'EVIL\u0000\u001b[31m' + 'x'.repeat(100)
    const got = parseSplPrices({ coins: { [`solana:${JUP}`]: { price: 1, symbol } } }, [JUP]).get(JUP)!.symbol
    expect(got).not.toMatch(/[\u0000-\u001f\u007f]/)
    expect(got.length).toBeLessThanOrEqual(32)
  })

  it('is not fooled by a key called __proto__', () => {
    expect(parseSplPrices({ coins: JSON.parse('{"__proto__":{"price":5}}') }, ['__proto__']).size).toBe(0)
  })
})

describe('solana rpc and prices over fetch', () => {
  it('asks getTokenAccountsByOwner with the token program, jsonParsed', async () => {
    const calls: unknown[] = []
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)))
      return answer({ result: { value: [account(USDC, '1000000', 6)] } })
    }) as unknown as typeof fetch
    const [usdc] = await createSolanaRpc({ fetch: fetchImpl, urls: ['https://sol.test'] }).getTokenBalances(WALLET)
    expect(usdc.balance.toString()).toBe('1')
    expect(calls[0]).toMatchObject({
      method: 'getTokenAccountsByOwner',
      params: [WALLET, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }],
    })
  })

  it('batches mints, 50 per request, and sends them with their case', async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      return answer({ coins: {} })
    }) as unknown as typeof fetch
    const many = Array.from({ length: 120 }, (_, i) => `Mint${i}`.padEnd(44, 'A'))
    await createSolanaTokenPrices({ fetch: fetchImpl }).getSplPrices([JUP, JUP, ...many])
    expect(urls).toHaveLength(3) // 121 distinct mints
    expect(urls[0]).toContain(`solana:${JUP}`)
  })
})

describe('solana scan', () => {
  const tokens = (): SolTokenProvider => ({
    getTokenBalances: async () => [
      { mint: USDC, decimals: 6, balance: dec('25') },
      { mint: JUP, decimals: 6, balance: dec('3') },
      { mint: SPAM, decimals: 6, balance: dec('999') },
      { mint: EMPTY, decimals: 6, balance: dec('0') },
    ],
    getMintDecimals: async () => 6,
  })
  const prices = (known: Record<string, string>, fails = false): SolTokenPriceProvider => ({
    getSplPrices: async (mints) => {
      if (fails) throw new ProviderError('defillama', 'http', 'HTTP 429')
      return new Map(mints.filter((m) => known[m]).map((m) => [m, { priceUsd: dec(known[m]), symbol: m === USDC ? 'USDC' : 'JUP' }]))
    },
  })

  it('lists held tokens with their price, leaves an unpriced one without, and skips empty balances', async () => {
    const scan = createSolanaScan({ tokens: tokens(), prices: prices({ [USDC]: '0.9999', [JUP]: '0.22' }) })
    const found = await scan.listTokens('sol', WALLET)
    expect(found.map((t) => [t.contract, t.symbol, t.priceUsd?.toString() ?? null])).toEqual([
      [USDC, 'USDC', '0.9999'],
      [JUP, 'JUP', '0.22'],
      [SPAM, 'Spam…pam1', null],
    ])
  })

  it('still lists the tokens, unpriced, when the price source is down, and says so', async () => {
    const scan = createSolanaScan({ tokens: tokens(), prices: prices({}, true) })
    const found = await scan.listTokens('sol', WALLET)
    expect(found.every((t) => t.priceUsd === null)).toBe(true)
    expect(scan.pricesUnavailable?.('sol', WALLET)).toBe(true)
  })

  it('fails the scan when the wallet cannot be read, rather than reporting an empty wallet', async () => {
    const broken: SolTokenProvider = {
      getTokenBalances: async () => {
        throw new ProviderError('solana-rpc', 'http', 'HTTP 429')
      },
      getMintDecimals: async () => 6,
    }
    await expect(createSolanaScan({ tokens: broken, prices: prices({}) }).listTokens('sol', WALLET)).rejects.toBeInstanceOf(ProviderError)
  })
})
