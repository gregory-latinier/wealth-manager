import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from './api'
import { useAuth } from './auth'

/** Pages that can be hidden from the menu. Same list and order as the server. */
export type Section = 'crypto' | 'exchanges' | 'smardex' | 'staking' | 'aave' | 'bank' | 'stocks' | 'crowdlending' | 'mt5'

interface SettingsPayload {
  sections: Section[]
  hiddenSections: Section[]
}

const BASE = '/api/admin/settings'

export const settingsApi = {
  get: () => api<SettingsPayload>(BASE),
  setHidden: (hiddenSections: Section[]) => api<SettingsPayload>(BASE, { method: 'PATCH', body: { hiddenSections } }),
}

interface SettingsContextValue {
  hiddenSections: Section[]
  /** Hides or shows one page in the menu. The change is saved on the server, so every device shows the same menu. */
  setHidden: (section: Section, hidden: boolean) => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const [hiddenSections, setHiddenSections] = useState<Section[]>([])

  useEffect(() => {
    if (status !== 'authenticated') return
    // A failed read leaves the whole menu visible: better to show too much than to lock the owner out of a page.
    settingsApi.get().then((s) => setHiddenSections(s.hiddenSections), () => undefined)
  }, [status])

  const setHidden = useCallback(
    async (section: Section, hidden: boolean) => {
      const next = hidden ? [...new Set([...hiddenSections, section])] : hiddenSections.filter((s) => s !== section)
      const saved = await settingsApi.setHidden(next)
      setHiddenSections(saved.hiddenSections)
    },
    [hiddenSections]
  )

  const value = useMemo(() => ({ hiddenSections, setHidden }), [hiddenSections, setHidden])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
