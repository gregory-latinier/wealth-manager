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
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { formatMoney } from '../../lib/crypto'
import { gominingApi, type GominingLastValue, type GominingMiner, type GominingOverview, type GominingSettings, type ThCurrency } from '../../lib/gomining'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

function LastValue({ value, stale }: { value: GominingLastValue | null; stale: string }) {
  if (!value) {
    return (
      <Typography variant="body2" color="text.secondary">
        Not in a snapshot yet
      </Typography>
    )
  }
  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(value.usd, 'USD')}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {formatMoney(value.eur, 'EUR')} · {value.date}
      </Typography>
      {value.stale && (
        <Tooltip title={stale}>
          <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />
        </Tooltip>
      )}
    </>
  )
}

/** The value of one TH and what sits in the GoMining wallet. GoMining has no public API, so the owner types these in. */
function ValuesForm({ settings, onSaved }: { settings: GominingSettings; onSaved: () => void }) {
  const [thPrice, setThPrice] = useState(settings.thPrice ?? '')
  const [thCurrency, setThCurrency] = useState<ThCurrency>(settings.thCurrency)
  const [btc, setBtc] = useState(settings.btc)
  const [gmt, setGmt] = useState(settings.gmt)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setThPrice(settings.thPrice ?? '')
    setThCurrency(settings.thCurrency)
    setBtc(settings.btc)
    setGmt(settings.gmt)
  }, [settings])

  const unchanged = thPrice.trim() === (settings.thPrice ?? '') && thCurrency === settings.thCurrency && btc.trim() === settings.btc && gmt.trim() === settings.gmt

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await gominingApi.saveSettings({ thPrice: thPrice.trim(), thCurrency, btc: btc.trim(), gmt: gmt.trim() })
      onSaved()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper variant="outlined" component="form" onSubmit={save} sx={{ p: 2, mb: 3 }}>
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Value of 1 TH"
            value={thPrice}
            onChange={(e) => setThPrice(e.target.value)}
            size="small"
            fullWidth
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 16 } }}
            helperText="What you think one TH is worth, for example the price of one TH on the GoMining marketplace."
          />
          <TextField select size="small" label="Currency" value={thCurrency} onChange={(e) => setThCurrency(e.target.value as ThCurrency)} sx={{ minWidth: 110 }}>
            <MenuItem value="EUR">EUR</MenuItem>
            <MenuItem value="USD">USD</MenuItem>
          </TextField>
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="BTC in the wallet"
            value={btc}
            onChange={(e) => setBtc(e.target.value)}
            size="small"
            fullWidth
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 20 } }}
            helperText="Mining rewards waiting in your GoMining wallet. Priced automatically."
          />
          <TextField
            label="GMT in the wallet"
            value={gmt}
            onChange={(e) => setGmt(e.target.value)}
            size="small"
            fullWidth
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 26 } }}
            helperText="GoMining tokens held in the wallet. Priced automatically."
          />
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        <Box>
          <Button type="submit" variant="contained" disabled={busy || unchanged}>
            Save
          </Button>
        </Box>
      </Stack>
    </Paper>
  )
}

function MinerDialog({ open, miner, onClose, onSaved }: { open: boolean; miner: GominingMiner | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [th, setTh] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(miner?.name ?? '')
    setTh(miner?.th ?? '')
    setError(null)
  }, [open, miner])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (miner) await gominingApi.update(miner.id, { name: name.trim(), th: th.trim() })
      else await gominingApi.add({ name: name.trim(), th: th.trim() })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>{miner ? 'Edit miner' : 'Add a miner'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField
            label="TH"
            value={th}
            onChange={(e) => setTh(e.target.value)}
            required
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 20 } }}
            helperText="Computing power of the miner. Raise it when you upgrade the miner."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || name.trim() === '' || th.trim() === ''}>
          {miner ? 'Save' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ miner, onClose, onDeleted }: { miner: GominingMiner | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!miner) return
    setBusy(true)
    setError(null)
    try {
      await gominingApi.remove(miner.id)
      onDeleted()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={miner !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Delete this miner?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>{miner?.name} stops being counted in your net worth. Past snapshots keep their values. Pause it instead if you may want it back.</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button color="error" variant="contained" onClick={confirm} disabled={busy}>
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default function Gomining() {
  const [data, setData] = useState<GominingOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<GominingMiner | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [deleting, setDeleting] = useState<GominingMiner | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await gominingApi.overview())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = async (miner: GominingMiner) => {
    setActionError(null)
    try {
      await gominingApi.update(miner.id, { active: !miner.active })
      await load()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  const openDialog = (miner: GominingMiner | null) => {
    setEditing(miner)
    setDialogOpen(true)
  }

  const totalTh = (data?.miners ?? []).filter((m) => m.active).reduce((sum, m) => sum + Number(m.th), 0)
  const priceMissing = data !== null && data.miners.some((m) => m.active) && data.settings.thPrice === null

  return (
    <AdminNav>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <Box>
          <Typography variant="h5" component="h1">
            GoMining
          </Typography>
          <Typography variant="body2" color="text.secondary">
            GoMining has no public API and your miners live in your GoMining account, so you type them in here. Each miner counts as its TH times the value of one TH below. The BTC and
            GMT in your wallet are priced automatically when the snapshot is taken.
            {totalTh > 0 && ` Counted now: ${totalTh.toLocaleString('en', { maximumFractionDigits: 4 })} TH.`}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => openDialog(null)}>
          Add miner
        </Button>
      </Box>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
      {priceMissing && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Set the value of 1 TH below. Until then your miners cannot be valued and are left out of the snapshot, or keep their last value marked as stale.
        </Alert>
      )}

      {data === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {data && (
        <>
          <ValuesForm settings={data.settings} onSaved={() => void load()} />

          <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
            Wallet
          </Typography>
          <TableContainer component={Paper} variant="outlined" sx={{ mb: 3 }}>
            <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
              <TableHead>
                <TableRow>
                  <TableCell>Asset</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell align="right">Last value</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {(
                  [
                    ['BTC', data.settings.btc, data.wallet.btc],
                    ['GMT', data.settings.gmt, data.wallet.gmt],
                  ] as const
                ).map(([symbol, amount, last]) => (
                  <TableRow key={symbol}>
                    <TableCell sx={{ fontWeight: 600 }}>{symbol}</TableCell>
                    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                      {amount}
                    </TableCell>
                    <TableCell align="right">
                      {Number(amount) === 0 ? (
                        <Typography variant="body2" color="text.secondary">
                          —
                        </Typography>
                      ) : (
                        <LastValue value={last} stale="The price could not be read last time, so the previous value was kept." />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Typography variant="subtitle1" component="h2" sx={{ mb: 1 }}>
            Miners
          </Typography>
          {data.miners.length === 0 ? (
            <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">No miner yet. Add one with its TH.</Typography>
            </Paper>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Miner</TableCell>
                    <TableCell align="right">TH</TableCell>
                    <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                      Last value
                    </TableCell>
                    <TableCell align="center">Counted</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.miners.map((m) => (
                    <TableRow key={m.id} sx={{ opacity: m.active ? 1 : 0.6 }}>
                      <TableCell sx={{ fontWeight: 600 }}>{m.name}</TableCell>
                      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {Number(m.th).toLocaleString('en', { maximumFractionDigits: 4 })}
                      </TableCell>
                      <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                        <LastValue value={m.lastValue} stale="The value of 1 TH could not be used last time, so the previous value was kept." />
                      </TableCell>
                      <TableCell align="center">
                        <Switch checked={m.active} onChange={() => void toggle(m)} slotProps={{ input: { 'aria-label': `${m.active ? 'Pause' : 'Resume'} ${m.name}` } }} />
                      </TableCell>
                      <TableCell align="right">
                        <IconButton aria-label={`Edit ${m.name}`} onClick={() => openDialog(m)}>
                          <EditIcon />
                        </IconButton>
                        <IconButton aria-label={`Delete ${m.name}`} onClick={() => setDeleting(m)}>
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </>
      )}

      <MinerDialog open={dialogOpen} miner={editing} onClose={() => setDialogOpen(false)} onSaved={() => void load()} />
      <ConfirmDelete miner={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
