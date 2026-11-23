import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import Mt5Icon from '@mui/icons-material/QueryStatsOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { formatMoney } from '../../lib/crypto'
import { mt5Api, type Mt5Account, type Mt5Currency, type Mt5Settings } from '../../lib/mt5'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Account names come from the monitoring feed and are rendered as React text, never as HTML.

/** A balance whose currency is not chosen yet, so it has no symbol. */
const plainAmount = (value: string) => new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value))

function CurrencySelect({ value, onChange, label, disabled }: { value: Mt5Currency | ''; onChange: (c: Mt5Currency) => void; label: string; disabled?: boolean }) {
  return (
    <TextField select size="small" label={label} value={value} onChange={(e) => onChange(e.target.value as Mt5Currency)} disabled={disabled} sx={{ minWidth: 110 }}>
      <MenuItem value="EUR">EUR</MenuItem>
      <MenuItem value="USD">USD</MenuItem>
    </TextField>
  )
}

/** The address of the owner's own accounts-monitoring snapshot. Nothing is assumed: every owner runs their own collector. */
function FeedUrlForm({ settings, onSaved }: { settings: Mt5Settings | null; onSaved: () => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const stored = settings?.feedUrlSource === 'setting' ? settings.feedUrl ?? '' : ''

  useEffect(() => {
    setUrl(stored)
  }, [stored])

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await mt5Api.setFeedUrl(url.trim())
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" component="form" onSubmit={save} sx={{ p: 2, mb: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'flex-start' } }}>
        <TextField
          label="Monitoring feed URL"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-vps.example.com/accounts-monitoring/api/snapshot"
          fullWidth
          size="small"
          autoComplete="off"
          error={error !== null}
          slotProps={{ htmlInput: { maxLength: 500, inputMode: 'url' } }}
          helperText={
            error ??
            (settings?.feedUrlSource === 'environment'
              ? 'Currently taken from the MT5_FEED_URL environment variable. Save a URL here to override it.'
              : 'The address of the snapshot your accounts-monitoring collector serves. It must list your accounts with their balance. Leave empty to forget it.')
          }
        />
        <Button type="submit" variant="contained" disabled={busy || url.trim() === stored}>
          Save
        </Button>
      </Stack>
    </Paper>
  )
}

function ConfirmDelete({ account, onClose, onDeleted }: { account: Mt5Account | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      await mt5Api.remove(account.login)
      onDeleted()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={account !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Stop counting this account?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {account?.name} ({account?.login}) stops being counted in your net worth. Past snapshots keep their values. The account stays in the list, so you can count it
          again.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={busy}>
          Stop counting
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Mt5() {
  const [accounts, setAccounts] = useState<Mt5Account[] | null>(null)
  const [feedError, setFeedError] = useState<string | null>(null)
  const [feedConfigured, setFeedConfigured] = useState(true)
  const [settings, setSettings] = useState<Mt5Settings | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Mt5Account | null>(null)
  // The currency picked for an account that is not counted yet. Nothing is assumed: the owner has to choose it.
  const [picked, setPicked] = useState<Record<string, Mt5Currency>>({})

  const load = useCallback(async () => {
    try {
      const [res, st] = await Promise.all([mt5Api.list(), mt5Api.settings()])
      setAccounts(res.accounts)
      setFeedError(res.feedError)
      setFeedConfigured(res.feedConfigured)
      setSettings(st)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: () => Promise<unknown>) => {
    setActionError(null)
    try {
      await action()
      await load()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const counted = (accounts ?? []).filter((a) => a.tracked?.active)
  const total = counted.reduce((sums, a) => ({ ...sums, [a.tracked!.currency]: (sums[a.tracked!.currency] ?? 0) + Number(a.balance ?? 0) }), {} as Record<string, number>)
  const totalText = (['USD', 'EUR'] as const)
    .filter((c) => (total[c] ?? 0) > 0)
    .map((c) => formatMoney(String(total[c]), c))
    .join(' and ')

  return (
    <AdminNav>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">
          MT5 accounts
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Balances are read from the snapshot your accounts-monitoring collector serves, once a day when the snapshot is taken. The balance counts, not the equity: open trades are not included. The
          feed does not say which currency an account is in, so choose it for each account you want to count.
          {totalText && ` Counted now: ${totalText}.`}
        </Typography>
      </Box>

      <FeedUrlForm settings={settings} onSaved={() => void load()} />

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {!feedConfigured && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Set the feed URL above to list your accounts.
        </Alert>
      )}
      {feedError && feedConfigured && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The monitoring feed could not be read: {feedError}. Accounts already counted keep their last value in the next snapshot, marked as stale.
        </Alert>
      )}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {accounts === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {accounts?.length === 0 && !feedError && feedConfigured && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <Mt5Icon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No MT5 account in the feed
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto' }}>
            The monitoring feed lists no account. Once your collector reports one, it shows up here.
          </Typography>
        </Paper>
      )}

      {accounts && accounts.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Currency</TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  Last value
                </TableCell>
                <TableCell align="center">Counted</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((a) => {
                const t = a.tracked
                const choice = picked[a.login] ?? ''
                return (
                  <TableRow key={a.login} sx={{ opacity: t && !t.active ? 0.6 : 1 }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {a.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" component="div">
                        {a.login}
                        {a.broker && ` · ${a.broker}`}
                      </Typography>
                      {a.problem && (
                        <Tooltip title={t ? 'This account keeps its last value, marked stale, until the collector reports it again.' : 'It cannot be valued until the collector reports it again.'}>
                          <Chip size="small" color={t ? 'warning' : 'default'} variant="outlined" label={a.problem} sx={{ mt: 0.5, maxWidth: '100%' }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                      {a.balance === null ? '—' : t ? formatMoney(a.balance, t.currency) : plainAmount(a.balance)}
                    </TableCell>
                    <TableCell>
                      {t ? (
                        <CurrencySelect label="Currency" value={t.currency} onChange={(currency) => void run(() => mt5Api.update(a.login, { currency }))} />
                      ) : (
                        <CurrencySelect label="Choose" value={choice} onChange={(c) => setPicked((p) => ({ ...p, [a.login]: c }))} />
                      )}
                    </TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      {t?.lastValue ? (
                        <>
                          <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                            {formatMoney(t.lastValue.usd, 'USD')}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {formatMoney(t.lastValue.eur, 'EUR')} · {t.lastValue.date}
                          </Typography>
                          {t.lastValue.stale && (
                            <Tooltip title="The balance could not be read last time, so the previous value was kept.">
                              <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />
                            </Tooltip>
                          )}
                        </>
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {t ? 'Not in a snapshot yet' : '—'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="center">
                      {t ? (
                        <Switch
                          checked={t.active}
                          onChange={() => void run(() => mt5Api.update(a.login, { active: !t.active }))}
                          slotProps={{ input: { 'aria-label': `${t.active ? 'Pause' : 'Resume'} ${a.name}` } }}
                        />
                      ) : (
                        <Button size="small" variant="contained" disabled={!choice} onClick={() => void run(() => mt5Api.add({ login: a.login, currency: choice as Mt5Currency }))}>
                          Count
                        </Button>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {t && (
                        <IconButton aria-label="Stop counting this account" onClick={() => setDeleting(a)}>
                          <DeleteIcon />
                        </IconButton>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <ConfirmDelete account={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
