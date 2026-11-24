import { createSolanaRpc, parseSolBalance, solRpcUrlsFromEnv } from './solana'
import { ProviderError } from './types'

const ADDRESS = 'So11111111111111111111111111111111111111112'

const answer = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response

function fakeFetch(...responses: Array<Response | Error>) {
  const calls: Array<{ url: string; body: unknown }> = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) })
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  return { fetch: fetchImpl, calls }
}

describe('solana', () => {
  it('converts lamports to SOL without float rounding', () => {
    expect(parseSolBalance({ result: { value: 1_500_000_000 } }).toString()).toBe('1.5')
    // toFixed, because Decimal#toString writes 1e-9 for the smallest amount.
    expect(parseSolBalance({ result: { value: 1 } }).toFixed()).toBe('0.000000001')
    expect(parseSolBalance({ result: { value: 0 } }).toString()).toBe('0')
  })

  it('treats an RPC error or a malformed answer as a failure, never as a zero balance', () => {
    expect(() => parseSolBalance({ error: { message: 'Too many requests' } })).toThrow(ProviderError)
    for (const bad of [null, {}, { result: {} }, { result: { value: '5' } }, { result: { value: -1 } }, { result: { value: 1.5 } }]) {
      expect(() => parseSolBalance(bad)).toThrow(ProviderError)
    }
  })

  it('asks for the finalized balance of the address', async () => {
    const f = fakeFetch(answer({ result: { value: 2_000_000_000 } }))
    const balance = await createSolanaRpc({ fetch: f.fetch, urls: ['https://sol.test'] }).getBalance(ADDRESS)
    expect(balance.toString()).toBe('2')
    expect(f.calls[0].url).toBe('https://sol.test')
    expect(f.calls[0].body).toMatchObject({ method: 'getBalance', params: [ADDRESS, { commitment: 'finalized' }] })
  })

  it('moves on to the next URL when one fails, and reports the last error when all fail', async () => {
    const ok = fakeFetch(answer({}, 429), answer({ result: { value: 1_000_000_000 } }))
    expect((await createSolanaRpc({ fetch: ok.fetch, urls: ['https://a.test', 'https://b.test'] }).getBalance(ADDRESS)).toString()).toBe('1')
    expect(ok.calls.map((c) => c.url)).toEqual(['https://a.test', 'https://b.test'])

    const down = fakeFetch(answer({}, 429))
    await expect(createSolanaRpc({ fetch: down.fetch, urls: ['https://a.test', 'https://b.test'] }).getBalance(ADDRESS)).rejects.toBeInstanceOf(ProviderError)
    expect(down.calls).toHaveLength(2)
  })

  it('reads the RPC URLs from the environment, falling back to the default', () => {
    expect(solRpcUrlsFromEnv({ SOL_RPC_URL: 'https://a.test, https://b.test' } as NodeJS.ProcessEnv)).toEqual(['https://a.test', 'https://b.test'])
    expect(solRpcUrlsFromEnv({ SOL_RPC_URL: ' ' } as NodeJS.ProcessEnv)).toEqual(['https://api.mainnet-beta.solana.com'])
  })
})
