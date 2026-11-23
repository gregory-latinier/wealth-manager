import { deleteSetting, getSetting, setSetting } from '../../lib/settings'

const FEED_URL_KEY = 'mt5.feedUrl'
export const MAX_FEED_URL_LENGTH = 500

/** The URL as it will be stored, or null when it is not an http(s) address. */
export function parseFeedUrl(input: string): string | null {
  const text = input.trim()
  if (!text || text.length > MAX_FEED_URL_LENGTH) return null
  try {
    const url = new URL(text)
    // Credentials in a URL would be stored in clear and shown on the page.
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return null
    return url.toString()
  } catch {
    return null
  }
}

/**
 * Where to read the accounts-monitoring snapshot. The owner sets it on the MT5 page. MT5_FEED_URL is the fallback for a
 * deployment that prefers the environment. There is no default: every owner runs their own collector.
 */
export async function getFeedUrl(): Promise<string | null> {
  const stored = await getSetting(FEED_URL_KEY)
  if (stored) return stored
  return parseFeedUrl(process.env.MT5_FEED_URL ?? '')
}

/** Null forgets the stored URL, so the environment fallback applies again. */
export async function setFeedUrl(url: string | null): Promise<void> {
  if (url === null) await deleteSetting(FEED_URL_KEY)
  else await setSetting(FEED_URL_KEY, url)
}

/** Where the URL in use comes from, so the page can say whether the environment supplies it. */
export async function feedUrlSource(): Promise<'setting' | 'environment' | null> {
  if (await getSetting(FEED_URL_KEY)) return 'setting'
  return parseFeedUrl(process.env.MT5_FEED_URL ?? '') ? 'environment' : null
}
