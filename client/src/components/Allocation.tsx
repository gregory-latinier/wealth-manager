import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import { Cell, Pie, PieChart } from 'recharts'
import { formatMoney } from '../lib/crypto'
import { compactMoney, groupKey, groupLabel, type BreakdownLine, type Currency, type Grouping } from '../lib/dashboard'
import GroupingToggle from './GroupingToggle'

// Violet ramp first, then cool neighbours so adjacent slices stay distinguishable on the dark surface.
const SLICES = ['#a78bfa', '#7c4dff', '#4cd9a0', '#5eb5ff', '#6b6485']
const MAX_NAMED = SLICES.length - 1

interface Slice {
  /** Stable identity of the slice, used for highlighting. */
  key: string
  label: string
  value: number
  share: number
}

/** Sums lines per group, keeps the largest few and folds the rest into "Other". */
function slices(lines: BreakdownLine[], currency: Currency, grouping: Grouping): Slice[] {
  const byGroup = new Map<string, { label: string; value: number }>()
  for (const l of lines) {
    const key = groupKey(l, grouping)
    const label = groupLabel(l, grouping)
    const v = Number(currency === 'USD' ? l.valueUsd : l.valueEur)
    byGroup.set(key, { label, value: (byGroup.get(key)?.value ?? 0) + v })
  }
  const sorted = [...byGroup].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, s) => sum + s.value, 0)
  const head = sorted.slice(0, sorted.length > SLICES.length ? MAX_NAMED : SLICES.length)
  const rest = sorted.slice(head.length).reduce((sum, s) => sum + s.value, 0)
  const all = rest > 0 ? [...head, { key: '\u0000other', label: 'Other', value: rest }] : head
  return all.map((s) => ({ ...s, share: total > 0 ? (s.value / total) * 100 : 0 }))
}

/**
 * Donut plus legend. Hovering or focusing a slice or a legend row highlights it, and a click pins the highlight.
 * The legend carries every value as text and is made of real buttons, so the donut itself stays decorative.
 */
export default function Allocation({ lines, currency, grouping, onGroupingChange }: { lines: BreakdownLine[]; currency: Currency; grouping: Grouping; onGroupingChange: (next: Grouping) => void }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)

  // A highlight from one grouping means nothing in the other.
  useEffect(() => {
    setHovered(null)
    setPinned(null)
  }, [grouping])

  const data = slices(lines, currency, grouping).filter((s) => s.value > 0)
  const total = data.reduce((sum, s) => sum + s.value, 0)
  // A pinned slice that no longer exists (other currency, other day) is ignored rather than leaving everything dimmed.
  const active = data.find((s) => s.key === (hovered ?? pinned)) ?? null

  const togglePin = (key: string) => setPinned((p) => (p === key ? null : key))

  return (
    <Box>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Typography variant="subtitle1" component="h2">
          Allocation
        </Typography>
        <GroupingToggle value={grouping} onChange={onGroupingChange} />
      </Stack>

      {data.length === 0 ? (
        <Typography color="text.secondary">Nothing to allocate.</Typography>
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row', md: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'center' }}>
          <Box
            aria-hidden
            sx={{
              position: 'relative',
              flexShrink: 0,
              width: 168,
              height: 168,
              '& .recharts-sector': { cursor: 'pointer', outline: 'none', transition: 'fill-opacity 120ms' },
            }}
          >
            <PieChart width={168} height={168} accessibilityLayer={false}>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={56}
                outerRadius={80}
                paddingAngle={data.length > 1 ? 3 : 0}
                cornerRadius={6}
                stroke="none"
                isAnimationActive={false}
                onMouseEnter={(_, index) => setHovered(data[index]?.key ?? null)}
                onMouseLeave={() => setHovered(null)}
                onClick={(_, index) => data[index] && togglePin(data[index].key)}
              >
                {data.map((s, i) => (
                  <Cell key={s.key} fill={SLICES[i % SLICES.length]} fillOpacity={active && active.key !== s.key ? 0.3 : 1} />
                ))}
              </Pie>
            </PieChart>
            {/* The middle of the donut says what is highlighted, or the total when nothing is. */}
            <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
              <Box sx={{ maxWidth: 96 }}>
                <Typography variant="caption" color="text.secondary" component="div" noWrap>
                  {active ? active.label : 'Total'}
                </Typography>
                <Typography sx={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2, fontVariantNumeric: 'tabular-nums' }}>
                  {compactMoney(active ? active.value : total, currency)}
                </Typography>
                {active && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {active.share.toFixed(1)}%
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>

          <Stack spacing={0.5} sx={{ width: '100%', minWidth: 0 }}>
            {data.map((s, i) => {
              const dimmed = active !== null && active.key !== s.key
              return (
                <ButtonBase
                  key={s.key}
                  onMouseEnter={() => setHovered(s.key)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(s.key)}
                  onBlur={() => setHovered(null)}
                  onClick={() => togglePin(s.key)}
                  aria-pressed={pinned === s.key}
                  sx={{
                    width: '100%',
                    justifyContent: 'flex-start',
                    gap: 1.25,
                    px: 1,
                    py: 0.75,
                    borderRadius: 2,
                    textAlign: 'left',
                    opacity: dimmed ? 0.5 : 1,
                    bgcolor: active?.key === s.key ? 'action.hover' : 'transparent',
                    transition: 'opacity 120ms, background-color 120ms',
                  }}
                >
                  <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: SLICES[i % SLICES.length], flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }} noWrap>
                    {s.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(String(s.value), currency)}
                  </Typography>
                  <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                    {s.share.toFixed(1)}%
                  </Typography>
                </ButtonBase>
              )
            })}
          </Stack>
        </Stack>
      )}
    </Box>
  )
}
