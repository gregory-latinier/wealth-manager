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
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import LeverageIcon from '@mui/icons-material/CandlestickChartOutlined'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { formatMoney, shortAddress } from '../../lib/crypto'
import { smardexApi, type SmardexWallet, type SmardexWalletPositions } from '../../lib/smardex'

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
      await smardexApi.add({ label: label.trim(), address: address.trim() })
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
      <DialogTitle>Add a Smardex wallet</DialogTitle>
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
            helperText="Your own name for this wallet, for example Trading."
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

function RenameDialog({ wallet, onClose, onSaved }: { wallet: SmardexWallet | null; onClose: () => void; onSaved: () => void }) {
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
      await smardexApi.update(wallet.id, { label: label.trim() })
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

function ConfirmDelete({ wallet, onClose, onDeleted }: { wallet: SmardexWallet | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!wallet) return
    setBusy(true)
    setError(null)
    try {
      await smardexApi.remove(wallet.id)
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
          {wallet?.label} stops being tracked for Smardex. Past snapshots keep their values. Its balances under Crypto, if any, are not affected. If you add it
          again later, its history is read again from the start.
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

const number = (value: string, digits: number) => new Intl.NumberFormat('en', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(Number(value))
const wstEth = (value: string | null) => (value === null ? '—' : `${number(value, 4)} wstETH`)
const usd = (value: string | null) => (value === null ? '—' : formatMoney(value, 'USD'))
const signed = (value: string, text: string) => (Number(value) > 0 ? `+${text}` : text)
const tone = (value: string | null) => (value === null || Number(value) === 0 ? 'text.primary' : Number(value) > 0 ? 'success.main' : 'error.main')

/** A profit or loss: the amount, with its percentage of the collateral underneath. */
function Pnl({ amount, percent, format }: { amount: string | null; percent: string | null; format: (v: string) => string }) {
  if (amount === null) return <Typography variant="body2" color="text.secondary">—</Typography>
  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: tone(amount) }}>
        {signed(amount, format(amount))}
      </Typography>
      {percent !== null && (
        <Typography variant="caption" sx={{ color: tone(amount), fontVariantNumeric: 'tabular-nums' }}>
          {signed(percent, `${number(percent, 1)}%`)}
        </Typography>
      )}
    </>
  )
}

/** Open positions of one wallet, read from the chain when the panel opens. */
function PositionsPanel({ wallet }: { wallet: SmardexWallet }) {
  const [data, setData] = useState<SmardexWalletPositions | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await smardexApi.positions(wallet.id))
    } catch (err) {
      setError(errorText(err))
    } finally {
      setLoading(false)
    }
  }, [wallet.id])

  useEffect(() => {
    void load()
  }, [load])

  const price = data?.wstEthUsd ?? null

  return (
    <Paper variant="outlined" sx={{ mt: 3, p: { xs: 1.5, sm: 2.5 } }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600 }}>
            {wallet.label}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {price ? `Open positions · wstETH at ${formatMoney(price, 'USD')}` : 'Open positions'}
          </Typography>
        </Box>
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
            Reading the blockchain. The first time can take about 30 seconds, then it is quick.
          </Typography>
        </Stack>
      )}

      {data && data.positions.length === 0 && !error && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
          No open position on this wallet.
        </Typography>
      )}

      {data && data.positions.length > 0 && (
        <TableContainer sx={{ opacity: loading ? 0.5 : 1 }}>
          <Table size="small" sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 1.5 }, whiteSpace: 'nowrap' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Opened</TableCell>
                <TableCell align="right">Collateral</TableCell>
                <TableCell align="right">Leverage</TableCell>
                <TableCell align="right">Entry price</TableCell>
                <TableCell align="right">Liquidation price</TableCell>
                <TableCell align="right">Worth if closed now</TableCell>
                <TableCell align="right">PnL (wstETH)</TableCell>
                <TableCell align="right">PnL (USD)</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.positions.map((p) => {
                // How far wstETH can still fall before the position is liquidated.
                const margin =
                  price && p.liquidationPriceUsd ? ((Number(price) - Number(p.liquidationPriceUsd)) / Number(price)) * 100 : null
                return (
                  <TableRow key={`${p.tick}:${p.tickVersion}:${p.index}`}>
                    <TableCell>
                      {p.openedAt ? new Date(p.openedAt).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}
                      {p.error && (
                        <Tooltip title={p.error}>
                          <Chip size="small" color="warning" label="partial" sx={{ ml: 1 }} />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {wstEth(p.collateral)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        size {wstEth(p.size)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {p.leverage === null ? '—' : `${number(p.leverage, 2)}x`}
                    </TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {usd(p.entryPriceUsd)}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {usd(p.liquidationPriceUsd)}
                      </Typography>
                      {margin !== null && (
                        <Typography variant="caption" color="text.secondary">
                          {margin >= 0 ? `${number(String(margin), 0)}% below the price` : 'above the price'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                        {wstEth(p.valueWstEth)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {usd(p.valueUsd)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Pnl amount={p.pnlWstEth} percent={p.pnlWstEthPct} format={(v) => wstEth(v)} />
                    </TableCell>
                    <TableCell align="right">
                      <Pnl amount={p.pnlUsd} percent={p.pnlUsdPct} format={(v) => formatMoney(v, 'USD')} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {data && data.positions.length > 0 && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.5 }}>
          An estimate from the protocol at the current price. Closing fees and gas are not included, and the entry price is the one recorded when the position was
          opened. PnL in wstETH compares the position with the collateral you put in. PnL in USD also counts the move in the wstETH price since then.
        </Typography>
      )}
    </Paper>
  )
}

export default function Smardex() {
  const [wallets, setWallets] = useState<SmardexWallet[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<SmardexWallet | null>(null)
  const [deleting, setDeleting] = useState<SmardexWallet | null>(null)

  const load = useCallback(async () => {
    try {
      setWallets((await smardexApi.list()).wallets)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (w: SmardexWallet) => {
    setActionError(null)
    try {
      await smardexApi.update(w.id, { active: !w.active })
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
            Smardex
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Leveraged long positions on the wstETH market. Each open position is valued at its current net value, in wstETH.
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
            <LeverageIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No Smardex wallet yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Add the Ethereum address you trade from. Its open leveraged positions are included in your net worth. The wallet does not need to be under Crypto.
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
                <TableCell align="right">Last value</TableCell>
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
                        No open position in a snapshot yet
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
