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
import BankIcon from '@mui/icons-material/AccountBalanceOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { aaveApi, type AaveWallet, type AaveWalletPositions } from '../../lib/aave'
import { ApiError } from '../../lib/api'
import { formatMoney, shortAddress } from '../../lib/crypto'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/

// Names come from the owner and are rendered as React text, never as HTML.

function AddWalletDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setLabel('')
    setAddress('')
    setError(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await aaveApi.add({ label: label.trim(), address: address.trim() })
      onAdded()
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const invalid = address.trim() !== '' && !EVM_ADDRESS.test(address.trim())

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add an Aave wallet</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 100 } }}
            helperText="Your own name for this wallet, for example Lending."
          />
          <TextField
            label="Ethereum address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            error={invalid}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 100, spellCheck: false } }}
            helperText={invalid ? '0x followed by 40 hex characters' : 'Only the address is needed. Positions are read from the blockchain, nothing is signed.'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !label.trim() || !EVM_ADDRESS.test(address.trim())}>
          {busy ? 'Adding…' : 'Add wallet'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function RenameDialog({ wallet, onClose, onSaved }: { wallet: AaveWallet | null; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLabel(wallet?.label ?? '')
    setError(null)
  }, [wallet])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!wallet) return
    setBusy(true)
    setError(null)
    try {
      await aaveApi.update(wallet.id, { label: label.trim() })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={wallet !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Rename wallet</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={label} onChange={(e) => setLabel(e.target.value)} required autoFocus slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !label.trim() || label.trim() === wallet?.label}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ wallet, onClose, onDeleted }: { wallet: AaveWallet | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!wallet) return
    setBusy(true)
    setError(null)
    try {
      await aaveApi.remove(wallet.id)
      onDeleted()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={wallet !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Remove this wallet?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {wallet?.label} stops being tracked for Aave, and so does its borrowing, which will no longer be subtracted from your net worth. Past snapshots keep their
          values. Its balances under Crypto, if any, are not affected.
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={busy}>
          Remove
        </Button>
      </DialogActions>
    </Dialog>
  )
}

const amount = (value: string) => new Intl.NumberFormat('en', { maximumFractionDigits: 4 }).format(Number(value))
const usd = (value: string | null) => (value === null ? '—' : formatMoney(value, 'USD'))

/** Below 1.0 the position can be liquidated. Aave itself warns under 1.5, so that is where the colour changes. */
function healthTone(value: number): 'error' | 'warning' | 'success' {
  if (value < 1.1) return 'error'
  if (value < 1.5) return 'warning'
  return 'success'
}

/** What one wallet has supplied and owes, read from the chain when the panel opens. */
function PositionsPanel({ wallet }: { wallet: AaveWallet }) {
  const [data, setData] = useState<AaveWalletPositions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await aaveApi.positions(wallet.id))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [wallet.id])

  useEffect(() => {
    void load()
  }, [load])

  const supplied = data?.reserves.filter((r) => Number(r.supplied) > 0) ?? []
  const borrowed = data?.reserves.filter((r) => Number(r.debt) > 0) ?? []
  const sum = (values: Array<string | null>) => (values.some((v) => v === null) ? null : values.reduce((s, v) => s + Number(v), 0))
  const suppliedUsd = sum(supplied.map((r) => r.suppliedUsd))
  const borrowedUsd = sum(borrowed.map((r) => r.debtUsd))
  const health = data?.healthFactor ? Number(data.healthFactor) : null

  return (
    <Paper variant="outlined" sx={{ mt: 3, p: { xs: 1.5, sm: 2.5 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            {wallet.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Aave v4 · Ethereum
          </Typography>
        </Box>
        {health !== null && (
          <Tooltip title="Collateral value over debt value, adjusted by each asset's liquidation threshold. Below 1 the position can be liquidated.">
            <Chip color={healthTone(health)} label={`Health factor ${health.toFixed(2)}`} />
          </Tooltip>
        )}
        <Tooltip title="Read the positions again">
          <span>
            <IconButton aria-label={`Refresh ${wallet.label}`} onClick={() => void load()} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      {error && <Alert severity="error">{error}</Alert>}
      {data?.warnings.map((w) => (
        <Alert key={w} severity="warning" sx={{ mb: 1.5 }}>
          {w}
        </Alert>
      ))}

      {loading && !data && (
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', py: 2 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            Reading the blockchain.
          </Typography>
        </Stack>
      )}

      {data && supplied.length === 0 && borrowed.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          Nothing supplied or borrowed on this wallet.
        </Typography>
      )}

      {data && (supplied.length > 0 || borrowed.length > 0) && (
        <TableContainer sx={{ opacity: loading ? 0.5 : 1 }}>
          <Table size="small" sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 1.5 }, whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Asset</TableCell>
                <TableCell>Side</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Value</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {supplied.map((r) => (
                <TableRow key={`supply:${r.reserveId}`}>
                  <TableCell sx={{ fontWeight: 600 }}>{r.symbol}</TableCell>
                  <TableCell>Supplied</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {amount(r.supplied)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {usd(r.suppliedUsd)}
                  </TableCell>
                </TableRow>
              ))}
              {borrowed.map((r) => (
                <TableRow key={`debt:${r.reserveId}`}>
                  <TableCell sx={{ fontWeight: 600 }}>{r.symbol}</TableCell>
                  <TableCell>Borrowed</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>
                    −{amount(r.debt)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', color: 'error.main' }}>
                    {r.debtUsd === null ? '—' : `−${formatMoney(r.debtUsd, 'USD')}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {data && suppliedUsd !== null && borrowedUsd !== null && (supplied.length > 0 || borrowed.length > 0) && (
        <Typography variant="body2" sx={{ mt: 1.5, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          Net {formatMoney(String(suppliedUsd - borrowedUsd), 'USD')}
        </Typography>
      )}
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        Interest is included and grows every block. In your net worth the borrowing is subtracted from the collateral.
      </Typography>
    </Paper>
  )
}

export default function Aave() {
  const [wallets, setWallets] = useState<AaveWallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<AaveWallet | null>(null)
  const [deleting, setDeleting] = useState<AaveWallet | null>(null)

  const load = useCallback(async () => {
    try {
      setWallets((await aaveApi.list()).wallets)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (w: AaveWallet) => {
    setActionError(null)
    try {
      await aaveApi.update(w.id, { active: !w.active })
      await load()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  return (
    <AdminNav>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mb: 3, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" component="h1">
            Aave
          </Typography>
          <Typography variant="body2" color="text.secondary">
            What a wallet has supplied to Aave v4 counts as an asset, and what it has borrowed is subtracted from your net worth.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add wallet
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {wallets === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {wallets?.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <BankIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No Aave wallet yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Add the Ethereum address you lend and borrow from. Its collateral is added to your net worth and its debt is subtracted. The wallet does not need to be under Crypto.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add wallet
          </Button>
        </Paper>
      )}

      {wallets && wallets.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Wallet</TableCell>
                <TableCell align="right">Last net value</TableCell>
                <TableCell align="center">Tracked</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {wallets.map((w) => (
                <TableRow key={w.id} sx={{ opacity: w.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {w.label}
                    </Typography>
                    <Tooltip title={w.address}>
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ fontFamily: 'monospace' }}>
                        {shortAddress(w.address)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right">
                    {w.lastValue ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(w.lastValue.usd, 'USD')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMoney(w.lastValue.eur, 'EUR')} · {w.lastValue.date}
                        </Typography>
                        {w.lastValue.stale && (
                          <Tooltip title="A position could not be read last time, so its previous value was kept.">
                            <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />
                          </Tooltip>
                        )}
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        No position in a snapshot yet
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={w.active}
                      onChange={() => void togglePaused(w)}
                      slotProps={{ input: { 'aria-label': `${w.active ? 'Pause' : 'Resume'} ${w.label}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Rename wallet" onClick={() => setEditing(w)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Remove wallet" onClick={() => setDeleting(w)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Paused wallets are not read: they are not part of the net worth either. */}
      {wallets?.filter((w) => w.active).map((w) => <PositionsPanel key={w.id} wallet={w} />)}

      <AddWalletDialog open={adding} onClose={() => setAdding(false)} onAdded={() => void load()} />
      <RenameDialog wallet={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete wallet={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
