import { dec } from '../../lib/money'
import type { BankAccount } from './accounts'
import { accountRef, createBankSource } from './index'

const account = (over: Partial<BankAccount> = {}): BankAccount => ({
  id: 'ba1',
  name: 'Checking',
  bank: 'Boursorama',
  currency: 'EUR',
  balance: '1250.50',
  active: true,
  createdAt: '2026-11-20T00:00:00Z',
  ...over,
})

const build = (list: BankAccount[]) => createBankSource({ accounts: async () => list })
const RATE = dec('1.25')

describe('bank source', () => {
  it('values a USD account at 1 and a EUR account at the rate the engine uses', async () => {
    const res = await build([account({ id: 'ba_1' }), account({ id: 'ba_2', currency: 'USD', balance: '300' })]).collect({ date: '2026-11-20', usdPerEur: RATE })
    expect(res.failures).toEqual([])
    expect(res.lines.map((l) => [l.sourceRef, l.symbol, l.amount.toString(), l.priceUsd.toString()])).toEqual([
      ['ba_1:EUR', 'EUR', '1250.5', '1.25'],
      ['ba_2:USD', 'USD', '300', '1'],
    ])
  })

  it('keeps an overdraft as a negative line', async () => {
    const res = await build([account({ balance: '-80.25' })]).collect({ date: '2026-11-20', usdPerEur: RATE })
    expect(res.lines[0]!.amount.isNegative()).toBe(true)
  })

  it('fails a EUR account when the rate is unavailable, never values it at 0', async () => {
    const res = await build([account(), account({ id: 'ba_2', currency: 'USD' })]).collect({ date: '2026-11-20' })
    expect(res.lines.map((l) => l.sourceRef)).toEqual(['ba_2:USD'])
    expect(res.failures).toEqual([{ sourceRef: accountRef(account()), reason: expect.stringContaining('rate') }])
  })

  it('returns nothing when no account is tracked', async () => {
    expect(await build([]).collect({ date: '2026-11-20', usdPerEur: RATE })).toEqual({ lines: [], failures: [] })
  })
})
