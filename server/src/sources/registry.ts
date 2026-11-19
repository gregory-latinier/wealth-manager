import type { SourceType } from './types'

const sources = new Map<string, SourceType>()

/** Adding a source type means registering it here. The engine itself never changes. */
export function registerSource(source: SourceType): void {
  if (sources.has(source.id)) throw new Error(`Source type already registered: ${source.id}`)
  sources.set(source.id, source)
}

export function getSources(): SourceType[] {
  return [...sources.values()]
}
