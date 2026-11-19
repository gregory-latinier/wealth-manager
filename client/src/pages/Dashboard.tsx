import { Alert, Box, CircularProgress, Paper, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import ArrowDownIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpIcon from '@mui/icons-material/ArrowUpward'
import RemoveIcon from '@mui/icons-material/Remove'
import { useEffect, useState } from 'react'
import AdminNav from '../components/AdminNav'
import Breakdown from '../components/Breakdown'
import NetWorthChart from '../components/NetWorthChart'
import { ApiError } from '../lib/api'
import { formatMoney } from '../lib/crypto'
import { fetchDashboard, type Change, type Currency, type DashboardData } from '../lib/dashboard'

/** Signed change with an arrow and a sign, so direction never depends on color alone. */
function ChangeFigure({ label, change, currency }: { label: string; change: Change | null; currency: Currency }) {
  const figure = change ? (currency === 'USD' ? change.usd : change.eur) : null
  const sign = figure ? Math.sign(Number(figure.abs)) : 0
  const Icon = sign > 0 ? ArrowUpIcon : sign < 0 ? ArrowDownIcon : RemoveIcon
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {figure && change ? (
        <>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            <Icon fontSize="small" aria-hidden />
            <Typography variant="h6" component="p" sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {sign > 0 ? '+' : ''}
              {formatMoney(figure.abs, currency)}
              {figure.pct !== null && ` (${sign > 0 ? '+' : ''}${figure.pct}%)`}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.secondary">
            since {change.since}
          </Typography>
        </>
      ) : (
        <Typography variant="h6" component="p" color="text.secondary">
          Not enough history
        </Typography>
      )}
    </Box>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [currency, setCurrency] = useState<Currency>('USD')
  // Date whose breakdown is shown. null means the latest snapshot.
  const [date, setDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchDashboard(date ?? undefined)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load the dashboard.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [date])

  const latest = data?.latest ?? null
  const shownDate = data?.breakdown?.date ?? null
  const isLatest = !latest || shownDate === latest.date

  return (
    <AdminNav>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {!data && !error && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      )}

      {data && !latest && (
        <Typography color="text.secondary">
          No snapshot yet. Add an address under Crypto, then the daily cron (or <code>pnpm snapshot:run</code>) records the first one.
        </Typography>
      )}

      {/* While a new date loads, the previous render stays in place at reduced opacity. */}
      {data && latest && (
        <Stack spacing={3} sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }} aria-busy={loading}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h5" component="h1">
              Net worth
            </Typography>
            <ToggleButtonGroup size="small" exclusive value={currency} onChange={(_, v: Currency | null) => v && setCurrency(v)} aria-label="Currency">
              <ToggleButton value="USD">USD</ToggleButton>
              <ToggleButton value="EUR">EUR</ToggleButton>
            </ToggleButtonGroup>
          </Stack>

          {latest.status === 'partial' && (
            <Alert severity="warning">
              Today&rsquo;s snapshot is partial: some holdings could not be read and show their last known value (marked stale below).
            </Alert>
          )}
          {latest.rateStale && <Alert severity="info">The USD/EUR rate could not be refreshed, so the last known rate was used.</Alert>}

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="body2" color="text.secondary">
              As of {latest.date} (UTC)
            </Typography>
            <Typography component="p" sx={{ fontSize: 56, lineHeight: 1.1, fontWeight: 600, my: 1 }}>
              {formatMoney(currency === 'USD' ? latest.totalUsd : latest.totalEur, currency)}
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 6 }} sx={{ mt: 2 }}>
              <ChangeFigure label="1 day" change={data.change.day} currency={currency} />
              <ChangeFigure label="7 days" change={data.change.week} currency={currency} />
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
              Evolution in {currency}
            </Typography>
            <NetWorthChart series={data.series} currency={currency} selectedDate={shownDate} onSelectDate={(d) => setDate(d === latest.date ? null : d)} />
            {data.series.length >= 2 && (
              <Typography variant="caption" color="text.secondary">
                Click a day to see its holdings.
              </Typography>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 3 }}>
            <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
              Holdings on {shownDate}
              {!isLatest && (
                <Typography component="button" variant="body2" onClick={() => setDate(null)} sx={{ ml: 2, cursor: 'pointer', background: 'none', border: 0, color: 'primary.main', textDecoration: 'underline' }}>
                  Back to latest
                </Typography>
              )}
            </Typography>
            {data.breakdown && <Breakdown lines={data.breakdown.lines} currency={currency} />}
          </Paper>
        </Stack>
      )}
    </AdminNav>
  )
}
