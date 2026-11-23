import { createDefaultAaveSource } from './aave/index'
import { createDefaultBankSource } from './bank/index'
import { createDefaultCrowdlendingSource } from './crowdlending/index'
import { createDefaultCryptoSource } from './crypto/index'
import { createDefaultExchangeSource } from './exchange/index'
import { createDefaultMt5Source } from './mt5/index'
import { registerSource } from './registry'
import { createDefaultSmardexSource } from './smardex/index'
import { createDefaultStakingSource } from './staking/index'
import { createDefaultStocksSource } from './stocks/index'

let done = false

/** Registers every built-in source type. Safe to call more than once. A new source type adds one line here. */
export function registerDefaultSources(): void {
  if (done) return
  done = true
  registerSource(createDefaultCryptoSource())
  registerSource(createDefaultExchangeSource())
  registerSource(createDefaultSmardexSource())
  registerSource(createDefaultStakingSource())
  registerSource(createDefaultAaveSource())
  registerSource(createDefaultBankSource())
  registerSource(createDefaultStocksSource())
  registerSource(createDefaultCrowdlendingSource())
  registerSource(createDefaultMt5Source())
}
