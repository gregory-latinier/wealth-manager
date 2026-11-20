import { pool, query } from '../../db/index'
import { pgStore } from './store'

const ME = '0x806be92538e21d63eff9681f5b96dd4f52bfff31'
const ID = { tick: 64300, tickVersion: '0', index: '0' }

describe('pgStore', () => {
  beforeEach(async () => {
    await query('DELETE FROM "SmardexPosition"')
    await query('DELETE FROM "SmardexScan"')
  })

  afterAll(async () => {
    await pool.end()
  })

  it('round-trips the opening date and price', async () => {
    await pgStore.save(ME, [{ ...ID, openedAt: 1_738_000_000, entryPrice: '3687780000000000000000' }], '0xa')
    const state = await pgStore.load(ME)
    expect(state.lastTxHash).toBe('0xa')
    expect(state.positions).toEqual([{ ...ID, openedAt: 1_738_000_000, entryPrice: '3687780000000000000000' }])
  })

  it('returns a position cached without an opening as just its id', async () => {
    await pgStore.save(ME, [ID], '0xa')
    expect((await pgStore.load(ME)).positions).toEqual([ID])
  })

  it('fills in a missing opening later, and never erases one it already has', async () => {
    await pgStore.save(ME, [ID], '0xa')
    await pgStore.save(ME, [{ ...ID, openedAt: 100, entryPrice: '5' }], '0xb')
    expect((await pgStore.load(ME)).positions).toEqual([{ ...ID, openedAt: 100, entryPrice: '5' }])

    // A later hand-over event carries no opening: what is known stays.
    await pgStore.save(ME, [ID], '0xc')
    expect((await pgStore.load(ME)).positions).toEqual([{ ...ID, openedAt: 100, entryPrice: '5' }])
  })
})
