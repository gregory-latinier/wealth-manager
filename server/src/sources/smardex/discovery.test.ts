import { LONG_FARMING, PROTOCOL, TOPICS, UNIVERSAL_ROUTER } from './abi'
import { createBlockscoutHistory } from './discovery'

const ME = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'
const word = (v: bigint) => (v & ((1n << 256n) - 1n)).toString(16).padStart(64, '0')
const topicOf = (address: string) => '0x' + address.replace('0x', '').padStart(64, '0')

const tx = (hash: string, to: string, extra: Record<string, unknown> = {}) => ({ hash, to: { hash: to }, status: 'ok', block_number: 100, ...extra })

const openLog = (owner: string, tick: bigint, emitter = PROTOCOL) => ({
  address: { hash: emitter },
  topics: [TOPICS.initiatedOpen, topicOf(owner), topicOf(owner), null],
  data: '0x' + word(1n) + word(2n) + word(3n) + word(4n) + word(tick) + word(0n) + word(0n),
})

type Routes = Record<string, unknown>

/** Serves canned JSON by path (without the host and /api/v2). Anything unlisted is a test failure. */
function fakeFetch(routes: Routes, calls: string[] = []): typeof fetch {
  return (async (input: unknown) => {
    const path = String(input).replace('https://eth.blockscout.com/api/v2', '')
    calls.push(path)
    const body = routes[path]
    if (body === undefined) return new Response('{}', { status: 404 })
    return new Response(JSON.stringify(body), { status: 200 })
  }) as typeof fetch
}

const CHECKSUMMED = '0x806bE92538e21D63EfF9681F5b96dd4f52BFFF31'
const listing = `/addresses/${CHECKSUMMED}/transactions?filter=from`

describe('createBlockscoutHistory', () => {
  it('reads protocol and router transactions, ignores others, and returns positions oldest first', async () => {
    const calls: string[] = []
    const routes: Routes = {
      [listing]: {
        items: [tx('0xnew', UNIVERSAL_ROUTER), tx('0xother', '0x2222222222222222222222222222222222222222'), tx('0xold', PROTOCOL)],
        next_page_params: null,
      },
      '/transactions/0xnew/logs': { items: [openLog(ME, 67700n)], next_page_params: null },
      '/transactions/0xold/logs': { items: [openLog(ME, 64300n)], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes, calls) }).findNew(ME, null)

    expect(res.positions.map((p) => p.tick)).toEqual([64300, 67700])
    expect(res.newest).toBe('0xnew')
    expect(calls).not.toContain('/transactions/0xother/logs')
  })

  it('requests the checksummed address, because Blockscout answers 500 for lowercase', async () => {
    const calls: string[] = []
    await createBlockscoutHistory({ fetch: fakeFetch({ [listing]: { items: [], next_page_params: null } }, calls) }).findNew(ME, null)
    expect(calls[0]).toBe(listing)
  })

  it('follows the next page cursor', async () => {
    const routes: Routes = {
      [listing]: { items: [tx('0xa', PROTOCOL)], next_page_params: { block_number: 99, index: 3 } },
      [`/addresses/${CHECKSUMMED}/transactions?block_number=99&index=3`]: { items: [tx('0xb', PROTOCOL)], next_page_params: null },
      '/transactions/0xa/logs': { items: [openLog(ME, 1n)], next_page_params: null },
      '/transactions/0xb/logs': { items: [openLog(ME, 2n)], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    expect(res.positions.map((p) => p.tick)).toEqual([2, 1])
  })

  it('stops at the marker and only reads transactions newer than it', async () => {
    const calls: string[] = []
    const routes: Routes = {
      [listing]: { items: [tx('0xnew', PROTOCOL), tx('0xseen', PROTOCOL), tx('0xolder', PROTOCOL)], next_page_params: { block_number: 1 } },
      '/transactions/0xnew/logs': { items: [openLog(ME, 5n)], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes, calls) }).findNew(ME, '0xseen')

    expect(res.positions.map((p) => p.tick)).toEqual([5])
    expect(res.newest).toBe('0xnew')
    expect(calls).toEqual([listing, '/transactions/0xnew/logs'])
  })

  it('returns no newest hash when nothing is newer than the marker', async () => {
    const routes: Routes = { [listing]: { items: [tx('0xseen', PROTOCOL)], next_page_params: null } }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, '0xseen')
    expect(res).toEqual({ positions: [], newest: null })
  })

  it('skips failed and pending transactions', async () => {
    const routes: Routes = {
      [listing]: {
        items: [tx('0xfailed', PROTOCOL, { status: 'error' }), tx('0xpending', PROTOCOL, { block_number: null }), tx('0xgood', PROTOCOL)],
        next_page_params: null,
      },
      '/transactions/0xgood/logs': { items: [openLog(ME, 9n)], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    expect(res.positions.map((p) => p.tick)).toEqual([9])
    // The pending one is not the marker, or the next scan would skip it once it is mined.
    expect(res.newest).toBe('0xfailed')
  })

  it('ignores events for other owners and events not emitted by the protocol', async () => {
    const OTHER = '0x1111111111111111111111111111111111111111'
    const routes: Routes = {
      [listing]: { items: [tx('0xa', PROTOCOL)], next_page_params: null },
      '/transactions/0xa/logs': {
        items: [openLog(OTHER, 1n), openLog(ME, 2n, '0x3333333333333333333333333333333333333333'), openLog(ME, 3n)],
        next_page_params: null,
      },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    expect(res.positions.map((p) => p.tick)).toEqual([3])
  })

  it('reports a position handed back by LongFarming', async () => {
    const routes: Routes = {
      [listing]: { items: [tx('0xa', LONG_FARMING)], next_page_params: null },
      '/transactions/0xa/logs': {
        items: [
          {
            address: { hash: PROTOCOL },
            topics: [TOPICS.ownershipTransferred, topicOf(LONG_FARMING), topicOf(ME), null],
            data: '0x' + word(64300n) + word(0n) + word(0n),
          },
        ],
        next_page_params: null,
      },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    expect(res.positions).toEqual([{ tick: 64300, tickVersion: '0', index: '0' }])
  })

  it('keeps the opening date and lets the validated price win over the one at initiation', async () => {
    const validated = {
      address: { hash: PROTOCOL },
      topics: [TOPICS.validatedOpen, topicOf(ME), topicOf(ME)],
      // totalExpo, newStartPrice, then the id.
      data: '0x' + word(1n) + word(99n) + word(7n) + word(0n) + word(0n),
    }
    const routes: Routes = {
      [listing]: { items: [tx('0xvalidate', PROTOCOL), tx('0xinit', UNIVERSAL_ROUTER)], next_page_params: null },
      '/transactions/0xinit/logs': { items: [openLog(ME, 7n)], next_page_params: null },
      '/transactions/0xvalidate/logs': { items: [validated], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    // openLog carries timestamp 1 and start price 4.
    expect(res.positions).toEqual([{ tick: 7, tickVersion: '0', index: '0', openedAt: 1, entryPrice: '99' }])
  })

  it('uses the price at initiation while the position is not validated yet', async () => {
    const routes: Routes = {
      [listing]: { items: [tx('0xinit', UNIVERSAL_ROUTER)], next_page_params: null },
      '/transactions/0xinit/logs': { items: [openLog(ME, 7n)], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    expect(res.positions).toEqual([{ tick: 7, tickVersion: '0', index: '0', openedAt: 1, entryPrice: '4' }])
  })

  it('deduplicates a position seen in several transactions', async () => {
    const routes: Routes = {
      [listing]: { items: [tx('0xa', PROTOCOL), tx('0xb', PROTOCOL)], next_page_params: null },
      '/transactions/0xa/logs': { items: [openLog(ME, 7n)], next_page_params: null },
      '/transactions/0xb/logs': { items: [openLog(ME, 7n)], next_page_params: null },
    }
    const res = await createBlockscoutHistory({ fetch: fakeFetch(routes) }).findNew(ME, null)
    expect(res.positions).toHaveLength(1)
  })

  it('throws on an HTTP error so the caller keeps its cache and flags the scan', async () => {
    await expect(createBlockscoutHistory({ fetch: fakeFetch({}) }).findNew(ME, null)).rejects.toThrow('HTTP 404')
  })

  it('throws when the response has no items, not an empty result', async () => {
    await expect(createBlockscoutHistory({ fetch: fakeFetch({ [listing]: { message: 'nope' } }) }).findNew(ME, null)).rejects.toThrow('no items')
  })
})
