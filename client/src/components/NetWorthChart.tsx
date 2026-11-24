import { Box, Typography, useTheme } from '@mui/material'
import { useMemo } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { VIOLET } from '../theme'
import type { Currency, DashboardData } from '../lib/dashboard'
import { usePrefersReducedMotion } from '../lib/motion'
import { useMoney } from '../lib/privacy'

// A single series, so no legend box and no dual axis. The app is dark only, so one violet.
const SERIES = VIOLET.accent

interface Point {
  date: string
  value: number
  raw: string
  partial: boolean
}

interface TooltipProps {
  active?: boolean
  payload?: { payload: Point }[]
  currency: Currency
}

function ChartTooltip({ active, payload, currency }: TooltipProps) {
  const { money } = useMoney()
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <Box sx={{ bgcolor: '#1a1229', border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1, boxShadow: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {p.date}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 600 }}>
        {money(p.raw, currency)}
      </Typography>
      {p.partial && (
        <Typography variant="caption" color="text.secondary">
          Partial snapshot
        </Typography>
      )}
    </Box>
  )
}

export default function NetWorthChart({
  series,
  currency,
  selectedDate,
  onSelectDate,
}: {
  series: DashboardData['series']
  currency: Currency
  selectedDate: string | null
  onSelectDate: (date: string) => void
}) {
  const theme = useTheme()
  const { compact, hidden } = useMoney()
  const reduced = usePrefersReducedMotion()
  const color = SERIES
  const surface = theme.palette.background.paper

  // Memoized, and before the early return so the hook order never changes. Clicking a day re-renders this component, and a fresh
  // array each time would make the chart redraw its line from the left.
  const data: Point[] = useMemo(
    () =>
      series.map((s) => {
        const raw = currency === 'USD' ? s.totalUsd : s.totalEur
        return { date: s.date, value: Number(raw), raw, partial: s.status === 'partial' }
      }),
    [series, currency]
  )

  if (series.length < 2) {
    return (
      <Typography color="text.secondary">
        {series.length === 0 ? 'No snapshot yet.' : 'The chart appears once there are two snapshots, one per day.'}
      </Typography>
    )
  }
  const selected = data.find((d) => d.date === selectedDate)
  const last = data[data.length - 1]

  return (
    <Box role="img" aria-label={`Net worth in ${currency} from ${data[0].date} to ${last.date}. The same values are in the table below.`} sx={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          onClick={(state) => {
            const label = state?.activeLabel
            if (typeof label === 'string') onSelectDate(label)
          }}
        >
          <defs>
            <linearGradient id="wm-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={color} stopOpacity={0.45} />
              <stop offset="1" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={theme.palette.divider} strokeDasharray="3 5" strokeWidth={1} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} minTickGap={32} />
          <YAxis
            width={64}
            tickLine={false}
            axisLine={false}
            tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
            // The axis labels would give the scale away, so they go too. The line keeps its shape.
            tickFormatter={(v: number) => compact(v, currency)}
            hide={hidden}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: theme.palette.text.secondary, strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            fill="url(#wm-area)"
            dot={false}
            activeDot={{ r: 5, fill: color, stroke: surface, strokeWidth: 2 }}
            // The line draws itself from the left on first load and morphs when the currency changes.
            isAnimationActive={!reduced}
            animationDuration={1100}
            animationEasing="ease-out"
          />
          {/* End marker with its surface ring, plus a marker on the date whose breakdown is shown. */}
          <Area
            dataKey="value"
            stroke="none"
            fill="none"
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              const isLast = props.index === data.length - 1
              const isSelected = selected !== undefined && props.index === data.indexOf(selected)
              if (props.cx === undefined || props.cy === undefined || (!isLast && !isSelected)) return <g key={props.index} />
              return <circle key={props.index} cx={props.cx} cy={props.cy} r={isLast ? 4 : 5} fill={color} stroke={surface} strokeWidth={2} />
            }}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  )
}
