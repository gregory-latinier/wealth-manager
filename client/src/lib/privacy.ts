import { useSyncExternalStore } from 'react'
import { formatMoney } from './crypto'
import { compactMoney, type Currency } from './dashboard'

// Whether monetary values are hidden. Kept in the browser, not on the server: it is about who can see this screen right now,
// so each device decides for itself. A module-level store keeps every component in step without a provider.
const KEY = 'wm.hideAmounts'
export const MASK = '••••'

const listeners = new Set<() => void>()

function readStored(): boolean {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false // storage can be blocked (private mode), the values are then simply shown
  }
}

let hidden = readStored()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function setHidden(next: boolean) {
  hidden = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // Not saved, but the switch still works for this session.
  }
  listeners.forEach((l) => l())
}

export function useAmountsHidden(): { hidden: boolean; toggle: () => void } {
  const value = useSyncExternalStore(subscribe, () => hidden)
  return { hidden: value, toggle: () => setHidden(!hidden) }
}

/** Money formatters that print a mask while amounts are hidden. Use these instead of formatMoney on screens that can be masked. */
export function useMoney() {
  const { hidden: masked } = useAmountsHidden()
  return {
    hidden: masked,
    money: (value: string, currency: Currency) => (masked ? MASK : formatMoney(value, currency)),
    compact: (value: number, currency: Currency) => (masked ? MASK : compactMoney(value, currency)),
  }
}
