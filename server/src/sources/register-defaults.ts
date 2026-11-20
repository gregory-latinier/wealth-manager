import { createDefaultCryptoSource } from './crypto/index'
import { createDefaultExchangeSource } from './exchange/index'
import { registerSource } from './registry'

let done = false

/** Registers every built-in source type. Safe to call more than once. A new source type adds one line here. */
export function registerDefaultSources(): void {
  if (done) return
  done = true
  registerSource(createDefaultCryptoSource())
  registerSource(createDefaultExchangeSource())
}
