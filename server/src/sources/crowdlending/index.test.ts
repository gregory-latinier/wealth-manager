import { dec } from '../../lib/money'
import { createCrowdlendingSource, loanRef } from './index'
import type { Loan } from './loans'

const loan = (over: Partial<Loan> = {}): Loan => ({
  id: 'cl1',
  platform: '8lends',
  name: 'Residence Lyon',
  currency: 'EUR',
  lent: '500.00',
  outstanding: '500.00',
  dueDate: '2027-03-15',
  active: true,
  createdAt: '2026-11-20T00:00:00Z',
  ...over,
})

const build = (list: Loan[]) => createCrowdlendingSource({ loans: async () => list })
const RATE = dec('1.25')

describe('crowdlending source', () => {
  it('values the outstanding amount, not the amount lent, at the rate the engine uses', async () => {
    const res = await build([loan({ outstanding: '350.50' })]).collect({ date: '2026-11-20', usdPerEur: RATE })
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([['cl1:EUR', 'EUR', '350.5', '1.25']])
  })

  it('values a USD loan at 1, with no rate needed, and keeps its own ref', async () => {
    const usd = loan({ id: 'cl2', currency: 'USD', outstanding: '300.00' })
    const res = await build([usd]).collect({ date: '2026-11-20' })
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([['cl2:USD', 'USD', '300', '1']])
  })

  it('keeps a repaid loan as a zero line', async () => {
    const res = await build([loan({ outstanding: '0.00' })]).collect({ date: '2026-11-20', usdPerEur: RATE })
    expect(res.lines.map((l) => l.amount.toString())).toEqual(['0'])
  })

  it('fails a EUR loan when the rate is unavailable, never values it at 0, and still values a USD one', async () => {
    const res = await build([loan(), loan({ id: 'cl2', currency: 'USD' })]).collect({ date: '2026-11-20' })
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['cl2:USD'])
    expect(res.failures).toEqual([{ sourceRef: loanRef(loan()), reason: expect.stringContaining('rate') }])
  })

  it('returns nothing when no loan is tracked', async () => {
    expect(await build([]).collect({ date: '2026-11-20', usdPerEur: RATE })).toEqual({ lines: [], failures: [] })
  })
})
