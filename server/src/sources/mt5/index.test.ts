import { dec } from '../../lib/money'
import { ProviderError } from '../crypto/providers/types'
import type { Mt5Account } from './accounts'
import type { FeedAccount, Mt5Feed } from './feed'
import { accountRef, createMt5Source } from './index'

const tracked = (over: Partial<Mt5Account> = {}): Mt5Account => ({ login: '111', currency: 'USD', active: true, createdAt: '2026-11-20T00:00:00Z', ...over })
const fed = (over: Partial<FeedAccount> = {}): FeedAccount => ({
  login: '111',
  name: 'Master',
  broker: 'RoboForex',
  balance: dec('422.05'),
  problem: null,
  updatedAt: new Date('2026-11-23T15:00:00Z'),
  ...over,
})

const feedOf = (list: FeedAccount[]): Mt5Feed => ({ accounts: async () => list })
const build = (accounts: Mt5Account[], feed: Mt5Feed) => createMt5Source({ accounts: async () => accounts, feed })
const RATE = dec('1.25')

describe('mt5 source', () => {
  it('values a USD account at its balance, with no rate needed', async () => {
    const res = await build([tracked()], feedOf([fed()])).collect({ date: '2026-11-23' })
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([['111:USD', 'USD', '422.05', '1']])
  })

  it('values a EUR account at the rate the engine uses', async () => {
    const res = await build([tracked({ currency: 'EUR' })], feedOf([fed()])).collect({ date: '2026-11-23', usdPerEur: RATE })
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.priceUsd.toString()])).toEqual([['111:EUR', 'EUR', '1.25']])
  })

  it('fails a EUR account when the rate is unavailable, never values it at 0, and still values a USD one', async () => {
    const res = await build([tracked({ currency: 'EUR' }), tracked({ login: '222' })], feedOf([fed(), fed({ login: '222' })])).collect({ date: '2026-11-23' })
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['222:USD'])
    expect(res.failures).toEqual([{ sourceRef: '111:EUR', reason: expect.stringContaining('rate') }])
  })

  it('only values the accounts that are tracked, not every account of the feed', async () => {
    const res = await build([tracked()], feedOf([fed(), fed({ login: '999', balance: dec('5') })])).collect({ date: '2026-11-23' })
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['111:USD'])
  })

  it('reports an error row with the collector reason instead of a zero line', async () => {
    const res = await build([tracked()], feedOf([fed({ balance: null, problem: 'error: terminal not connected' })])).collect({ date: '2026-11-23' })
    expect(res.lines).toEqual([])
    expect(res.failures).toEqual([{ sourceRef: '111:USD', reason: 'error: terminal not connected' }])
  })

  it('keeps a real zero balance as a zero line', async () => {
    const res = await build([tracked()], feedOf([fed({ balance: dec(0) })])).collect({ date: '2026-11-23' })
    expect(res.lines.map((l) => l.amount.toString())).toEqual(['0'])
  })

  it('fails an account the feed no longer lists', async () => {
    const res = await build([tracked()], feedOf([])).collect({ date: '2026-11-23' })
    expect(res.failures).toEqual([{ sourceRef: '111:USD', reason: expect.stringContaining('not in the monitoring feed') }])
  })

  it('fails every tracked account when the feed is down, so each keeps its last value', async () => {
    const feed: Mt5Feed = {
      accounts: async () => {
        throw new ProviderError('mt5-feed', 'timeout', 'no answer within 15000 ms')
      },
    }
    const res = await build([tracked({ login: '222' }), tracked()], feed).collect({ date: '2026-11-23', usdPerEur: RATE })
    expect(res.lines).toEqual([])
    expect(res.failures.map((f) => f.sourceRef)).toEqual(['111:USD', '222:USD'])
    expect(res.failures[0]!.reason).toContain('feed is unavailable')
  })

  it('does not call the feed when nothing is tracked', async () => {
    const feed: Mt5Feed = {
      accounts: async () => {
        throw new Error('should not be called')
      },
    }
    expect(await build([], feed).collect({ date: '2026-11-23' })).toEqual({ lines: [], failures: [] })
  })

  it('builds the ref from login and currency', () => {
    expect(accountRef({ login: '37363418', currency: 'EUR' })).toBe('37363418:EUR')
  })
})
