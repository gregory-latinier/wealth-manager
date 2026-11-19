import { Box, Typography, useTheme } from '@mui/material'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatMoney } from '../lib/crypto'
import { compactMoney, type Currency, type DashboardData } from '../lib/dashboard'

// Series 1 of the reference palette, stepped for each surface. A single series, so no legend box and no dual axis.
const SERIES = { light: '#2a78d6', dark: '#3987e5' }

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
  if (!active || !payload?.length) return null
  const p = payload[0].payload
  return (
    <Box sx={{ bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 1, px: 1.5, py: 1, boxShadow: 2 }}>
      <Typography variant="caption" color="text.secondary" component="div">
        {p.date}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 600 }}>
        {formatMoney(p.raw, currency)}
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
  const color = SERIES[theme.palette.mode]
  const surface = theme.palette.background.paper

  if (series.length < 2) {
    return (
      <Typography color="text.secondary">
        {series.length === 0 ? 'No snapshot yet.' : 'The chart appears once there are two snapshots, one per day.'}
      </Typography>
    )
  }

  const data: Point[] = series.map((s) => {
    const raw = currency === 'USD' ? s.totalUsd : s.totalEur
    return { date: s.date, value: Number(raw), raw, partial: s.status === 'partial' }
  })
  const selected = data.find((d) => d.date === selectedDate)
  const last = data[data.length - 1]

  return (
    <Box role="img" aria-label={`Net worth in ${currency} from ${data[0].date} to ${last.date}. The same values are in the table below.`} sx={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          onClick={(state) => {
            const label = state?.activeLabel
            if (typeof label === 'string') onSelectDate(label)
          }}
        >
          <CartesianGrid vertical={false} stroke={theme.palette.divider} strokeWidth={1} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: theme.palette.divider }} tick={{ fill: theme.palette.text.secondary, fontSize: 12 }} minTickGap={32} />
          <YAxis
            width={64}
            tickLine={false}
            axisLine={false}
            tick={{ fill: theme.palette.text.secondary, fontSize: 12 }}
            tickFormatter={(v: number) => compactMoney(v, currency)}
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
            fill={color}
            fillOpacity={0.1}
            dot={false}
            activeDot={{ r: 5, fill: color, stroke: surface, strokeWidth: 2 }}
            isAnimationActive={false}
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
