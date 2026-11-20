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
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import ExchangeIcon from '@mui/icons-material/CurrencyExchange'
import KeyIcon from '@mui/icons-material/VpnKeyOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { formatMoney } from '../../lib/crypto'
import { KEY_HELP, exchangeApi, type ExchangeAccount, type ExchangeId, type ExchangeInfo, type ExchangeList } from '../../lib/exchange'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Labels come from the owner and are rendered as React text, never as HTML. Keys are only ever typed in, never shown.

/** Key fields shared by "add an account" and "replace the key". The secret is a password field and is never prefilled. */
function KeyFields({
  exchange,
  values,
  onChange,
}: {
  exchange: ExchangeId
  values: { apiKey: string; apiSecret: string; passphrase: string }
  onChange: (next: { apiKey: string; apiSecret: string; passphrase: string }) => void
}) {
  return (
    <>
      <Alert severity="info" icon={<KeyIcon fontSize="inherit" />}>
        {KEY_HELP[exchange]} Only balances are read, so a key that can also trade is not needed and is better not created.
      </Alert>
      <TextField
        label="API key"
        value={values.apiKey}
        onChange={(e) => onChange({ ...values, apiKey: e.target.value })}
        required
        autoComplete="off"
        slotProps={{ htmlInput: { maxLength: 512, spellCheck: false } }}
      />
      <TextField
        label="API secret"
        type="password"
        value={values.apiSecret}
        onChange={(e) => onChange({ ...values, apiSecret: e.target.value })}
        required
        autoComplete="new-password"
        slotProps={{ htmlInput: { maxLength: 512, spellCheck: false } }}
        helperText="Stored encrypted on the server. It is never shown again."
      />
      {exchange === 'okx' && (
        <TextField
          label="Passphrase"
          type="password"
          value={values.passphrase}
          onChange={(e) => onChange({ ...values, passphrase: e.target.value })}
          required
          autoComplete="new-password"
          slotProps={{ htmlInput: { maxLength: 512 } }}
        />
      )}
    </>
  )
}

const EMPTY_KEYS = { apiKey: '', apiSecret: '', passphrase: '' }
const toCredentials = (v: typeof EMPTY_KEYS) => ({
  apiKey: v.apiKey,
  apiSecret: v.apiSecret,
  ...(v.passphrase ? { passphrase: v.passphrase } : {}),
})

function AddAccountDialog({ open, exchanges, onClose, onAdded }: { open: boolean; exchanges: ExchangeInfo[]; onClose: () => void; onAdded: () => void }) {
  const [exchange, setExchange] = useState<ExchangeId>('kraken')
  const [label, setLabel] = useState('')
  const [keys, setKeys] = useState(EMPTY_KEYS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    // The secret must not stay in memory after the dialog closes.
    setLabel('')
    setKeys(EMPTY_KEYS)
    setError(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await exchangeApi.add({ exchange, label: label.trim(), credentials: toCredentials(keys) })
      onAdded()
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const missingPassphrase = exchange === 'okx' && !keys.passphrase

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Connect an exchange</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label="Exchange" value={exchange} onChange={(e) => setExchange(e.target.value as ExchangeId)}>
            {exchanges.map((x) => (
              <MenuItem key={x.id} value={x.id}>
                {x.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 100 } }}
            helperText="Your own name for this account, for example Main."
          />
          <KeyFields exchange={exchange} values={keys} onChange={setKeys} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !label.trim() || !keys.apiKey.trim() || !keys.apiSecret.trim() || missingPassphrase}>
          {busy ? 'Checking the key…' : 'Connect'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function EditAccountDialog({ account, onClose, onSaved }: { account: ExchangeAccount | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [replaceKey, setReplaceKey] = useState(false)
  const [keys, setKeys] = useState(EMPTY_KEYS)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLabel(account?.label ?? '')
    setReplaceKey(false)
    setKeys(EMPTY_KEYS)
    setError(null)
  }, [account])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      await exchangeApi.update(account.id, {
        ...(label.trim() !== account.label ? { label: label.trim() } : {}),
        ...(replaceKey ? { credentials: toCredentials(keys) } : {}),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const keysIncomplete = replaceKey && (!keys.apiKey.trim() || !keys.apiSecret.trim() || (account?.exchange === 'okx' && !keys.passphrase))
  const unchanged = !replaceKey && label.trim() === account?.label

  return (
    <Dialog open={account !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Edit account</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus slotProps={{ htmlInput: { maxLength: 100 } }} />
          {!replaceKey ? (
            <Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                The saved key can not be shown. Replace it if it was revoked or you rotated it.
              </Typography>
              <Button startIcon={<KeyIcon />} onClick={() => setReplaceKey(true)}>
                Replace the key
              </Button>
            </Box>
          ) : (
            account && <KeyFields exchange={account.exchange} values={keys} onChange={setKeys} />
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !label.trim() || keysIncomplete || unchanged}>
          {busy && replaceKey ? 'Checking the key…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ account, onClose, onDeleted }: { account: ExchangeAccount | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      await exchangeApi.remove(account.id)
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
      <DialogTitle>Disconnect this account?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {account?.label} stops being tracked and its saved key is deleted from this app. Past snapshots keep their values. To make sure the key can no
          longer be used, also delete it on the exchange.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={busy}>
          Disconnect
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Exchanges() {
  const [data, setData] = useState<ExchangeList | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ExchangeAccount | null>(null)
  const [deleting, setDeleting] = useState<ExchangeAccount | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await exchangeApi.list())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (a: ExchangeAccount) => {
    setActionError(null)
    try {
      await exchangeApi.update(a.id, { active: !a.active })
      await load()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const nameOf = (a: ExchangeAccount) => data?.exchanges.find((x) => x.id === a.exchange)?.label ?? a.exchange

  return (
    <AdminNav>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mb: 3, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" component="h1">
            Exchanges
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Read-only API keys. Every balance on the account is tracked, including staked assets.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)} disabled={!data?.ready}>
          Connect exchange
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
      {data && !data.ready && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          The server has no EXCHANGE_KEY_SECRET, so keys cannot be stored safely. Set it (at least 32 characters, for example from{' '}
          <code>openssl rand -hex 32</code>) and restart the server. Keep it: without it saved keys can not be read again.
        </Alert>
      )}

      {data === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {data?.accounts.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <ExchangeIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No exchange connected
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Connect Kraken with a read-only API key to include its balances in your net worth. The key can only see balances, it can not trade or withdraw.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)} disabled={!data.ready}>
            Connect exchange
          </Button>
        </Paper>
      )}

      {data && data.accounts.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Exchange</TableCell>
                <TableCell align="right">Last value</TableCell>
                <TableCell align="center">Tracked</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.accounts.map((a) => (
                <TableRow key={a.id} sx={{ opacity: a.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {a.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ display: { xs: 'block', sm: 'none' } }}>
                      {nameOf(a)}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    <Chip size="small" variant="outlined" label={nameOf(a)} />
                  </TableCell>
                  <TableCell align="right">
                    {a.lastValue ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(a.lastValue.usd, 'USD')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMoney(a.lastValue.eur, 'EUR')} · {a.lastValue.date}
                        </Typography>
                        {a.lastValue.stale && (
                          <Tooltip title="The exchange could not be read last time, so the previous value was kept.">
                            <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />
                          </Tooltip>
                        )}
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Not in a snapshot yet
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={a.active}
                      onChange={() => void togglePaused(a)}
                      slotProps={{ input: { 'aria-label': `${a.active ? 'Pause' : 'Resume'} ${a.label}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Edit account" onClick={() => setEditing(a)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Disconnect account" onClick={() => setDeleting(a)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <AddAccountDialog open={adding} exchanges={data?.exchanges ?? []} onClose={() => setAdding(false)} onAdded={() => void load()} />
      <EditAccountDialog account={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete account={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
