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
import WalletIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import TokenIcon from '@mui/icons-material/TokenOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import TokenScanDialog from '../../components/TokenScanDialog'
import TrackedTokensDialog from '../../components/TrackedTokensDialog'
import { ApiError } from '../../lib/api'
import { CHAIN_LABEL, cryptoApi, formatMoney, shortAddress, type Chain, type CryptoAddress } from '../../lib/crypto'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Every string below (labels, addresses) is rendered as React text, never as HTML.

function AddAddressDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: (a: CryptoAddress) => void }) {
  const [chain, setChain] = useState<Chain>('eth')
  const [address, setAddress] = useState('')
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setAddress('')
    setLabel('')
    setError(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const created = await cryptoApi.addAddress({ chain, address: address.trim(), ...(label.trim() ? { label: label.trim() } : {}) })
      onAdded(created)
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add an address</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField select label="Chain" value={chain} onChange={(e) => setChain(e.target.value as Chain)}>
            {(Object.keys(CHAIN_LABEL) as Chain[]).map((c) => (
              <MenuItem key={c} value={c}>
                {CHAIN_LABEL[c]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 200, spellCheck: false } }}
            helperText={chain === 'btc' ? 'A plain address, not an xpub.' : 'Starts with 0x. Tokens are picked after the address is added.'}
          />
          <TextField label="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !address.trim()}>
          Add
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function EditLabelDialog({ address, onClose, onSaved }: { address: CryptoAddress | null; onClose: () => void; onSaved: (a: CryptoAddress) => void }) {
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setLabel(address?.label ?? '')
    setError(null)
  }, [address])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      onSaved(await cryptoApi.updateAddress(address.id, { label: label.trim() || null }))
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={address !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Edit label</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Label" value={label} onChange={(e) => setLabel(e.target.value)} autoFocus slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ address, onClose, onDeleted }: { address: CryptoAddress | null; onClose: () => void; onDeleted: (id: string) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      await cryptoApi.deleteAddress(address.id)
      onDeleted(address.id)
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={address !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Delete this address?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {address?.label ? `${address.label} (${shortAddress(address.address)})` : address?.address} and its tracked tokens stop being tracked. Past snapshots
          keep their values.
        </DialogContentText>
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

export default function Crypto() {
  const [addresses, setAddresses] = useState<CryptoAddress[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<CryptoAddress | null>(null)
  const [deleting, setDeleting] = useState<CryptoAddress | null>(null)
  const [managing, setManaging] = useState<CryptoAddress | null>(null)
  const [scanning, setScanning] = useState<CryptoAddress | null>(null)

  const load = useCallback(async () => {
    try {
      setAddresses(await cryptoApi.listAddresses())
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (a: CryptoAddress) => {
    setActionError(null)
    try {
      await cryptoApi.updateAddress(a.id, { active: !a.active })
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
            Crypto addresses
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Public addresses only. Native coins are tracked automatically, tokens are picked per address.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add address
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {addresses === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {addresses?.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <WalletIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No address yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mb: 3 }}>
            Add a Bitcoin, Ethereum, Base or BNB Chain address to start tracking it. Only the public address is needed, never a key or seed phrase.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add address
          </Button>
        </Paper>
      )}

      {addresses && addresses.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Address</TableCell>
                <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>Chain</TableCell>
                <TableCell align="right">Last value</TableCell>
                <TableCell align="center">Tracked</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {addresses.map((a) => (
                <TableRow key={a.id} sx={{ opacity: a.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {a.label ?? 'Unlabeled'}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div" sx={{ display: { xs: 'block', sm: 'none' } }}>
                      {CHAIN_LABEL[a.chain]}
                    </Typography>
                    <Tooltip title={a.address}>
                      <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
                        {shortAddress(a.address)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    <Chip size="small" variant="outlined" label={CHAIN_LABEL[a.chain]} />
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
                        {a.lastValue.stale && <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />}
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
                      slotProps={{ input: { 'aria-label': `${a.active ? 'Pause' : 'Resume'} ${a.label ?? a.address}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    {a.chain !== 'btc' && (
                      <IconButton aria-label="Tracked tokens" onClick={() => setManaging(a)}>
                        <TokenIcon />
                      </IconButton>
                    )}
                    <IconButton aria-label="Edit label" onClick={() => setEditing(a)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Delete address" onClick={() => setDeleting(a)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <AddAddressDialog open={adding} onClose={() => setAdding(false)} onAdded={(a) => {
          void load()
          // A new EVM address goes straight to token selection.
          if (a.chain !== 'btc') setScanning({ ...a, lastValue: null })
        }}
      />
      <TrackedTokensDialog
        address={managing}
        onClose={() => setManaging(null)}
        onScan={(a) => {
          setManaging(null)
          setScanning(a)
        }}
      />
      <TokenScanDialog address={scanning} onClose={() => setScanning(null)} onChanged={() => void load()} />
      <EditLabelDialog address={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete address={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
