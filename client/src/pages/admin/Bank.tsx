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
import BankIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { bankApi, type BankAccount, type BankCurrency } from '../../lib/bank'
import { formatMoney } from '../../lib/crypto'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Same rule as the server: a plain number with at most 2 decimals. A minus sign is an overdraft.
const BALANCE = /^-?\d{1,18}(\.\d{1,2})?$/
const validBalance = (value: string) => BALANCE.test(value.trim())

// Account and bank names come from the owner and are rendered as React text, never as HTML.

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [bank, setBank] = useState('')
  const [currency, setCurrency] = useState<BankCurrency>('EUR')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setName('')
    setBank('')
    setCurrency('EUR')
    setBalance('')
    setError(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await bankApi.add({ name: name.trim(), bank: bank.trim(), currency, balance: balance.trim() })
      onAdded()
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badBalance = balance.trim() !== '' && !validBalance(balance)

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add a bank account</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Account name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 100 } }}
            helperText="For example Checking or Livret A."
          />
          <TextField label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} helperText="Optional." />
          <TextField
            select
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as BankCurrency)}
            helperText="Cannot be changed later. A EUR account is converted to USD at the daily rate."
          >
            <MenuItem value="EUR">EUR</MenuItem>
            <MenuItem value="USD">USD</MenuItem>
          </TextField>
          <TextField
            label="Balance"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            required
            error={badBalance}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 24 } }}
            helperText={badBalance ? 'A number with at most 2 decimals, without separators' : 'In the account currency. Use a minus sign for an overdraft.'}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !name.trim() || !validBalance(balance)}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function EditDialog({ account, onClose, onSaved }: { account: BankAccount | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [bank, setBank] = useState('')
  const [balance, setBalance] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(account?.name ?? '')
    setBank(account?.bank ?? '')
    setBalance(account?.balance ?? '')
    setError(null)
  }, [account])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      await bankApi.update(account.id, { name: name.trim(), bank: bank.trim(), balance: balance.trim() })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badBalance = balance.trim() !== '' && !validBalance(balance)
  const unchanged = name.trim() === account?.name && bank.trim() === account?.bank && balance.trim() === account?.balance

  return (
    <Dialog open={account !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Edit {account?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={`Balance (${account?.currency ?? ''})`}
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            required
            autoFocus
            error={badBalance}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 24 } }}
            helperText={badBalance ? 'A number with at most 2 decimals, without separators' : 'Update it whenever it changes. Past snapshots keep their values.'}
          />
          <TextField label="Account name" value={name} onChange={(e) => setName(e.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField label="Bank" value={bank} onChange={(e) => setBank(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !name.trim() || !validBalance(balance) || unchanged}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ account, onClose, onDeleted }: { account: BankAccount | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!account) return
    setBusy(true)
    setError(null)
    try {
      await bankApi.remove(account.id)
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
      <DialogTitle>Remove this account?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {account?.name} stops being counted in your net worth. Past snapshots keep their values. To record a closed or emptied account instead, set its balance
          to 0.
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

export default function Bank() {
  const [accounts, setAccounts] = useState<BankAccount[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<BankAccount | null>(null)
  const [deleting, setDeleting] = useState<BankAccount | null>(null)

  const load = useCallback(async () => {
    try {
      setAccounts((await bankApi.list()).accounts)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (a: BankAccount) => {
    setActionError(null)
    try {
      await bankApi.update(a.id, { active: !a.active })
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
            Bank accounts
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Balances you type in, in EUR or USD. Nothing is read from your bank: update a balance when it changes.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add account
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {accounts === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {accounts?.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <BankIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No bank account yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Add an account with its currency and current balance. Update the balance whenever it changes.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add account
          </Button>
        </Paper>
      )}

      {accounts && accounts.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell align="right">Last value</TableCell>
                <TableCell align="center">Counted</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {accounts.map((a) => (
                <TableRow key={a.id} sx={{ opacity: a.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {a.name}
                    </Typography>
                    {a.bank && (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {a.bank}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {formatMoney(a.balance, a.currency)}
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
                          <Tooltip title="The EUR/USD rate could not be read last time, so the previous value was kept.">
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
                      slotProps={{ input: { 'aria-label': `${a.active ? 'Pause' : 'Resume'} ${a.name}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Edit account" onClick={() => setEditing(a)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Remove account" onClick={() => setDeleting(a)}>
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <AddDialog open={adding} onClose={() => setAdding(false)} onAdded={() => void load()} />
      <EditDialog account={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete account={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
