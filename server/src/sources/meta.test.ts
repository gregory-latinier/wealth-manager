import { lineMeta, SOURCE_META } from './meta'
import { getSources } from './registry'
import { registerDefaultSources } from './register-defaults'

describe('source metadata', () => {
  it('has an entry for every registered source, so adding one without naming it fails here', () => {
    registerDefaultSources()
    const missing = getSources().map((s) => s.id).filter((id) => !(id in SOURCE_META))
    expect(missing).toEqual([])
  })

  it.each([
    ['crypto', 'eth:0xabc:native', '10', 'crypto', 'available'],
    ['exchange', 'kraken:1:BTC', '10', 'crypto', 'available'],
    ['bank', 'acct:EUR', '10', 'cash', 'available'],
    ['mt5', '123:USD', '10', 'cash', 'available'],
    ['stocks', 'h1:JEQP.DE', '10', 'stocks', 'available'],
    ['staking', 'p1:SDEX', '10', 'crypto', 'locked'],
    ['staking', 'p1:rewards', '10', 'crypto', 'available'],
    ['smardex', '0xabc:1:2:3', '10', 'crypto', 'locked'],
    ['gomining', 'm1:TH', '10', 'crypto', 'locked'],
    ['gomining', 'wallet:BTC', '10', 'crypto', 'available'],
    ['aave', '0xabc:r1:supply', '10', 'crypto', 'locked'],
    ['aave', '0xabc:r1:debt', '-10', 'crypto', 'borrowed'],
    ['crowdlending', 'l1:EUR', '10', 'crowdlending', 'locked'],
  ])('%s %s is %s / %s', (type, ref, value, category, status) => {
    expect(lineMeta(type, ref, value)).toMatchObject({ category, status })
  })

  it('treats any negative value as borrowed, whatever the source says', () => {
    expect(lineMeta('crypto', 'eth:0xabc:native', '-5').status).toBe('borrowed')
    expect(lineMeta('staking', 'p1:SDEX', '-5').status).toBe('borrowed')
  })

  it('names the category of a known source', () => {
    expect(lineMeta('exchange', 'kraken:1:BTC', '1')).toMatchObject({ sourceLabel: 'Exchanges', categoryLabel: 'Crypto' })
    expect(lineMeta('bank', 'a:EUR', '1').categoryLabel).toBe('Cash & trading accounts')
  })

  it('makes an unknown source its own available category instead of hiding it', () => {
    expect(lineMeta('newthing', 'x:1', '1')).toEqual({ sourceLabel: 'Newthing', category: 'newthing', categoryLabel: 'Newthing', status: 'available' })
  })
})
