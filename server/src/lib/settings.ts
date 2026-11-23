import { query } from '../db/index'

/** Owner settings live in the small key/value `Setting` table. */
export async function getSetting(key: string): Promise<string | null> {
  const res = await query<{ value: string }>(`SELECT "value" FROM "Setting" WHERE "key" = $1`, [key])
  return res.rows[0]?.value ?? null
}

export async function setSetting(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO "Setting" ("key", "value") VALUES ($1, $2)
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value"`,
    [key, value]
  )
}

export async function deleteSetting(key: string): Promise<void> {
  await query(`DELETE FROM "Setting" WHERE "key" = $1`, [key])
}

/** Every page of the app that can be hidden from the menu. The dashboard is not in the list: it is always shown. */
export const SECTIONS = ['crypto', 'exchanges', 'smardex', 'staking', 'aave', 'bank', 'stocks', 'crowdlending', 'mt5', 'gomining'] as const
export type Section = (typeof SECTIONS)[number]

const HIDDEN_KEY = 'ui.hiddenSections'

/** Sections the owner hid from the menu. Hiding only changes the menu: what is tracked is still counted. */
export async function getHiddenSections(): Promise<Section[]> {
  const raw = await getSetting(HIDDEN_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // A hand-edited or outdated value must not break the menu: keep only the known sections.
    return SECTIONS.filter((s) => parsed.includes(s))
  } catch {
    return []
  }
}

export async function setHiddenSections(hidden: readonly Section[]): Promise<void> {
  await setSetting(HIDDEN_KEY, JSON.stringify(SECTIONS.filter((s) => hidden.includes(s))))
}
