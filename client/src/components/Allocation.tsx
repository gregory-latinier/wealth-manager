import { Box, Stack, Typography } from '@mui/material'
import { Cell, Pie, PieChart } from 'recharts'
import { formatMoney } from '../lib/crypto'
import type { BreakdownLine, Currency } from '../lib/dashboard'

// Violet ramp first, then cool neighbours so adjacent slices stay distinguishable on the dark surface.
const SLICES = ['#a78bfa', '#7c4dff', '#4cd9a0', '#5eb5ff', '#6b6485']
const MAX_NAMED = SLICES.length - 1

interface Slice {
  symbol: string
  value: number
  share: number
}

/** Sums lines per symbol, keeps the largest few and folds the rest into "Other". */
function slices(lines: BreakdownLine[], currency: Currency): Slice[] {
  const bySymbol = new Map<string, number>()
  for (const l of lines) {
    const v = Number(currency === 'USD' ? l.valueUsd : l.valueEur)
    bySymbol.set(l.symbol, (bySymbol.get(l.symbol) ?? 0) + v)
  }
  const sorted = [...bySymbol].map(([symbol, value]) => ({ symbol, value })).sort((a, b) => b.value - a.value)
  const total = sorted.reduce((sum, s) => sum + s.value, 0)
  const head = sorted.slice(0, sorted.length > SLICES.length ? MAX_NAMED : SLICES.length)
  const rest = sorted.slice(head.length).reduce((sum, s) => sum + s.value, 0)
  const all = rest > 0 ? [...head, { symbol: 'Other', value: rest }] : head
  return all.map((s) => ({ ...s, share: total > 0 ? (s.value / total) * 100 : 0 }))
}

/** Donut plus legend. The legend carries every value as text, so the chart itself is decorative. */
export default function Allocation({ lines, currency }: { lines: BreakdownLine[]; currency: Currency }) {
  const data = slices(lines, currency).filter((s) => s.value > 0)
  if (data.length === 0) return <Typography color="text.secondary">Nothing to allocate.</Typography>

  return (
    <Stack direction={{ xs: 'column', sm: 'row', md: 'column', lg: 'row' }} spacing={3} sx={{ alignItems: 'center' }}>
      <Box aria-hidden sx={{ flexShrink: 0, width: 168, height: 168 }}>
        <PieChart width={168} height={168}>
          <Pie data={data} dataKey="value" nameKey="symbol" innerRadius={56} outerRadius={80} paddingAngle={data.length > 1 ? 3 : 0} cornerRadius={6} stroke="none" isAnimationActive={false}>
            {data.map((s, i) => (
              <Cell key={s.symbol} fill={SLICES[i % SLICES.length]} />
            ))}
          </Pie>
        </PieChart>
      </Box>
      <Stack spacing={1.25} sx={{ width: '100%', minWidth: 0 }}>
        {data.map((s, i) => (
          <Stack key={s.symbol} direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: SLICES[i % SLICES.length], flexShrink: 0 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }} noWrap>
              {s.symbol}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {formatMoney(String(s.value), currency)}
            </Typography>
            <Typography variant="body2" sx={{ minWidth: 48, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {s.share.toFixed(1)}%
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  )
}
