import { Alert, Box, Button, Paper, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import Grid from '@mui/material/Grid'
import ArrowDownIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpIcon from '@mui/icons-material/ArrowUpward'
import RemoveIcon from '@mui/icons-material/Remove'
import InsightsIcon from '@mui/icons-material/InsightsOutlined'
import { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import AdminNav from '../components/AdminNav'
import Allocation from '../components/Allocation'
import Breakdown from '../components/Breakdown'
import NetWorthChart from '../components/NetWorthChart'
import { ApiError } from '../lib/api'
import { formatMoney } from '../lib/crypto'
import { fetchDashboard, type Change, type Currency, type DashboardData } from '../lib/dashboard'

/**
 * Signed change as a pill. Direction is carried by the arrow and the sign, color only reinforces it.
 * A rise is not always good news for every reader, so the colors stay on the conventional green/red pair
 * and the text says the same thing.
 */
function ChangePill({ label, change, currency }: { label: string; change: Change | null; currency: Currency }) {
  const figure = change ? (currency === 'USD' ? change.usd : change.eur) : null
  const sign = figure ? Math.sign(Number(figure.abs)) : 0
  const Icon = sign > 0 ? ArrowUpIcon : sign < 0 ? ArrowDownIcon : RemoveIcon
  const tone = sign > 0 ? 'success' : sign < 0 ? 'error' : 'text'

  return (
    <Paper variant="outlined" sx={{ p: 2.5, height: '100%' }}>
      <Typography variant="overline" color="text.secondary" component="div">
        {label}
      </Typography>
      {figure && change ? (
        <>
          <Typography
            component="p"
            sx={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: tone === 'text' ? 'text.primary' : `${tone}.main` }}
          >
            {sign > 0 ? '+' : ''}
            {formatMoney(figure.abs, currency)}
          </Typography>
          <Box
            sx={(t) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              mt: 0.75,
              px: 1.25,
              py: 0.5,
              borderRadius: 999,
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 650,
              fontSize: 14,
              ...(tone === 'text'
                ? { bgcolor: 'action.hover', color: 'text.secondary' }
                : { bgcolor: `color-mix(in srgb, ${(t.vars ?? t).palette[tone].main} 16%, transparent)`, color: `${tone}.main` }),
            })}
          >
            <Icon sx={{ fontSize: 16 }} aria-hidden />
            <span>{figure.pct !== null ? `${sign > 0 ? '+' : ''}${figure.pct}%` : 'n/a'}</span>
          </Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1 }}>
            since {change.since}
          </Typography>
        </>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ py: 0.5 }}>
          Not enough history yet
        </Typography>
      )}
    </Paper>
  )
}

function DashboardSkeleton() {
  return (
    <Stack spacing={3} aria-busy="true" aria-label="Loading the dashboard">
      <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
        <Skeleton width={120} />
        <Skeleton variant="text" sx={{ fontSize: 56, maxWidth: 360 }} />
        <Skeleton variant="rounded" height={240} sx={{ mt: 3 }} />
      </Paper>
      <Skeleton variant="rounded" height={160} />
    </Stack>
  )
}

function EmptyState() {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
      <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
        <InsightsIcon fontSize="large" aria-hidden />
      </Box>
      <Typography variant="h6" component="h1" gutterBottom>
        No snapshot yet
      </Typography>
      <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
        Add an address under Crypto. The daily cron (or <code>pnpm snapshot:run</code>) then records the first snapshot and your net worth appears here.
      </Typography>
      <Button component={RouterLink} to="/admin/crypto" variant="contained">
        Add an address
      </Button>
    </Paper>
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
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {!data && !error && <DashboardSkeleton />}

      {data && !latest && <EmptyState />}

      {/* While a new date loads, the previous render stays in place at reduced opacity. */}
      {data && latest && (
        <Stack spacing={3} sx={{ opacity: loading ? 0.6 : 1, transition: 'opacity 150ms' }} aria-busy={loading}>
          {latest.status === 'partial' && (
            <Alert severity="warning">
              Today&rsquo;s snapshot is partial: some holdings could not be read and show their last known value (marked stale below).
            </Alert>
          )}
          {latest.rateStale && <Alert severity="info">The USD/EUR rate could not be refreshed, so the last known rate was used.</Alert>}

          <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 4 } }}>
            <Stack direction="row" sx={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
              <Box>
                <Typography variant="overline" color="text.secondary" component="h1">
                  Total portfolio value
                </Typography>
                <Typography
                  component="p"
                  sx={{ fontSize: { xs: 40, sm: 56 }, lineHeight: 1.1, fontWeight: 700, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatMoney(currency === 'USD' ? latest.totalUsd : latest.totalEur, currency)}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  As of {latest.date} (UTC)
                </Typography>
              </Box>
              <ToggleButtonGroup size="small" exclusive value={currency} onChange={(_, v: Currency | null) => v && setCurrency(v)} aria-label="Currency">
                <ToggleButton value="USD">USD</ToggleButton>
                <ToggleButton value="EUR">EUR</ToggleButton>
              </ToggleButtonGroup>
            </Stack>

            <Box sx={{ mt: 4 }}>
              <NetWorthChart series={data.series} currency={currency} selectedDate={shownDate} onSelectDate={(d) => setDate(d === latest.date ? null : d)} />
              {data.series.length >= 2 && (
                <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                  Click a day on the chart to see its holdings.
                </Typography>
              )}
            </Box>
          </Paper>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 8 }}>
              <Paper variant="outlined" sx={{ p: { xs: 2.5, sm: 3 }, height: '100%' }}>
                <Typography variant="subtitle1" component="h2" sx={{ mb: 2 }}>
                  Allocation
                </Typography>
                {data.breakdown && <Allocation lines={data.breakdown.lines} currency={currency} />}
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Stack spacing={3} sx={{ height: '100%' }}>
                <ChangePill label="1 day" change={data.change.day} currency={currency} />
                <ChangePill label="7 days" change={data.change.week} currency={currency} />
              </Stack>
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1, px: { xs: 0.5, sm: 0 } }}>
              <Typography variant="subtitle1" component="h2">
                Holdings on {shownDate}
              </Typography>
              {!isLatest && (
                <Button size="small" onClick={() => setDate(null)}>
                  Back to latest
                </Button>
              )}
            </Stack>
            {data.breakdown && <Breakdown lines={data.breakdown.lines} currency={currency} />}
          </Paper>
        </Stack>
      )}
    </AdminNav>
  )
}
