import { ProviderError } from './types'

export type FetchLike = typeof fetch

export const DEFAULT_TIMEOUT_MS = 15_000

/** GET or POST JSON with a hard timeout. Every failure becomes a ProviderError. */
export async function fetchJson(
  provider: string,
  doFetch: FetchLike,
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}
): Promise<unknown> {
  const signal = AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let res: Response
  try {
    res = await doFetch(url, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal,
    })
  } catch (err) {
    if (signal.aborted) throw new ProviderError(provider, 'timeout', `no answer within ${init.timeoutMs ?? DEFAULT_TIMEOUT_MS} ms`)
    throw new ProviderError(provider, 'network', err instanceof Error ? err.message : String(err))
  }

  if (!res.ok) throw new ProviderError(provider, 'http', `HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    if (signal.aborted) throw new ProviderError(provider, 'timeout', 'timed out while reading the response')
    throw new ProviderError(provider, 'malformed', 'response is not valid JSON')
  }
}

/** Runs at most `max` tasks at a time. Used to keep a provider's parallel requests small. */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let running = 0
  const waiting: Array<() => void> = []

  const release = () => {
    running--
    waiting.shift()?.()
  }

  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    running++
    try {
      return await task()
    } finally {
      release()
    }
  }
}
