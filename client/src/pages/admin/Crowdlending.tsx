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
import CrowdlendingIcon from '@mui/icons-material/HandshakeOutlined'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { crowdlendingApi, type Loan, type LoanCurrency } from '../../lib/crowdlending'
import { formatMoney } from '../../lib/crypto'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Same rule as the server: a plain number with at most 2 decimals.
const AMOUNT = /^\d{1,18}(\.\d{1,2})?$/
const validAmount = (value: string) => AMOUNT.test(value.trim())
const validLent = (value: string) => validAmount(value) && Number(value) > 0
const DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (value: string) => DATE.test(value) && !Number.isNaN(Date.parse(value))

// Platform and project names come from the owner and are rendered as React text, never as HTML.

const DAY_MS = 86_400_000
const SOON_DAYS = 30

/** Whole days from today to the refund date, negative when it is past. Both are calendar dates, so the time of day plays no part. */
function daysUntil(dueDate: string, now = new Date()): number {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((Date.parse(dueDate) - today) / DAY_MS)
}

/** The refund date with how far away it is. A repaid loan has nothing left to wait for. */
function DueCell({ loan }: { loan: Loan }) {
  if (Number(loan.outstanding) === 0) {
    return (
      <>
        <Typography variant="body2">{loan.dueDate}</Typography>
        <Chip size="small" color="success" variant="outlined" label="Repaid" />
      </>
    )
  }
  const days = daysUntil(loan.dueDate)
  const label = days < 0 ? `${-days} ${days === -1 ? 'day' : 'days'} overdue` : days === 0 ? 'Due today' : `in ${days} ${days === 1 ? 'day' : 'days'}`
  const color = days < 0 ? 'error' : days <= SOON_DAYS ? 'warning' : 'default'
  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {loan.dueDate}
      </Typography>
      <Tooltip title={days < 0 ? 'Past the expected refund date. Check the platform and update the loan.' : 'Expected refund date'}>
        <Chip size="small" color={color} variant={color === 'default' ? 'outlined' : 'filled'} label={label} />
      </Tooltip>
    </>
  )
}

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [platform, setPlatform] = useState('')
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState<LoanCurrency>('EUR')
  const [lent, setLent] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setPlatform('')
    setName('')
    setCurrency('EUR')
    setLent('')
    setDueDate('')
    setError(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await crowdlendingApi.add({ platform: platform.trim(), name: name.trim(), currency, lent: lent.trim(), dueDate })
      onAdded()
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badLent = lent.trim() !== '' && !validLent(lent)

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add a crowdlending loan</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            required
            autoFocus
            slotProps={{ htmlInput: { maxLength: 100 } }}
            helperText="For example 8lends or La Premiere Brique."
          />
          <TextField label="Project" value={name} onChange={(e) => setName(e.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} helperText="The project you financed." />
          <TextField
            select
            label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as LoanCurrency)}
            helperText="Cannot be changed later. A EUR loan is converted to USD at the daily rate."
          >
            <MenuItem value="EUR">EUR</MenuItem>
            <MenuItem value="USD">USD</MenuItem>
          </TextField>
          <TextField
            label={`Amount lent (${currency})`}
            value={lent}
            onChange={(e) => setLent(e.target.value)}
            required
            error={badLent}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 24 } }}
            helperText={badLent ? 'A number greater than 0, with at most 2 decimals' : 'Cannot be changed later. It counts in your net worth until it is refunded.'}
          />
          <TextField
            label="Expected refund date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            slotProps={{ inputLabel: { shrink: true } }}
            helperText="The day to check the refund. Move it if the project is extended."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !platform.trim() || !name.trim() || !validLent(lent) || !validDate(dueDate)}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function EditDialog({ loan, onClose, onSaved }: { loan: Loan | null; onClose: () => void; onSaved: () => void }) {
  const [platform, setPlatform] = useState('')
  const [name, setName] = useState('')
  const [outstanding, setOutstanding] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPlatform(loan?.platform ?? '')
    setName(loan?.name ?? '')
    setOutstanding(loan?.outstanding ?? '')
    setDueDate(loan?.dueDate ?? '')
    setError(null)
  }, [loan])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!loan) return
    setBusy(true)
    setError(null)
    try {
      await crowdlendingApi.update(loan.id, { platform: platform.trim(), name: name.trim(), outstanding: outstanding.trim(), dueDate })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badOutstanding = outstanding.trim() !== '' && (!validAmount(outstanding) || (loan !== null && Number(outstanding) > Number(loan.lent)))
  const unchanged =
    platform.trim() === loan?.platform && name.trim() === loan?.name && outstanding.trim() === loan?.outstanding && dueDate === loan?.dueDate

  return (
    <Dialog open={loan !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Edit {loan?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label={`Still to be refunded (${loan?.currency ?? ''})`}
            value={outstanding}
            onChange={(e) => setOutstanding(e.target.value)}
            required
            autoFocus
            error={badOutstanding}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 24 } }}
            helperText={
              badOutstanding
                ? `A number from 0 to ${loan?.lent}, with at most 2 decimals`
                : `Lent: ${loan ? formatMoney(loan.lent, loan.currency) : ''}. Lower it when you are refunded, set 0 when it is fully repaid.`
            }
          />
          <TextField
            label="Expected refund date"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField label="Project" value={name} onChange={(e) => setName(e.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !platform.trim() || !name.trim() || !validAmount(outstanding) || badOutstanding || !validDate(dueDate) || unchanged}
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ loan, onClose, onDeleted }: { loan: Loan | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!loan) return
    setBusy(true)
    setError(null)
    try {
      await crowdlendingApi.remove(loan.id)
      onDeleted()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={loan !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Remove this loan?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {loan?.name} stops being counted in your net worth. Past snapshots keep their values. To record a refund instead, edit the loan and set what is still to be
          refunded to 0.
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

export default function Crowdlending() {
  const [loans, setLoans] = useState<Loan[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Loan | null>(null)
  const [deleting, setDeleting] = useState<Loan | null>(null)

  const load = useCallback(async () => {
    try {
      setLoans((await crowdlendingApi.list()).loans)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (l: Loan) => {
    setActionError(null)
    try {
      await crowdlendingApi.update(l.id, { active: !l.active })
      await load()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  // Loans still waiting for a refund that is past its date, so they are called out above the table.
  const overdue = (loans ?? []).filter((l) => l.active && Number(l.outstanding) > 0 && daysUntil(l.dueDate) < 0)
  // One total per currency: a EUR and a USD amount do not add up.
  const totals = (['EUR', 'USD'] as const)
    .map((c) => ({ c, sum: (loans ?? []).filter((l) => l.active && l.currency === c).reduce((sum, l) => sum + Number(l.outstanding), 0) }))
    .filter((t) => t.sum > 0)
    .map((t) => formatMoney(String(t.sum), t.c))
    .join(' and ')

  return (
    <AdminNav>
      <Stack direction={{ xs: 'column', sm: 'row' }} sx={{ mb: 3, alignItems: { xs: 'flex-start', sm: 'center' }, gap: 2 }}>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h5" component="h1">
            Crowdlending
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Loans you made on platforms such as 8lends or La Premiere Brique. Only what is still to be refunded counts in your net worth. Nothing is read from the
            platforms: update a loan when you are refunded.
            {totals && ` Still to be refunded: ${totals}.`}
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add loan
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}
      {overdue.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {overdue.length === 1 ? '1 loan is' : `${overdue.length} loans are`} past the expected refund date: {overdue.map((l) => `${l.name} (${l.platform})`).join(', ')}.
          Check the platform, then update the amount still to be refunded or move the date.
        </Alert>
      )}

      {loans === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {loans?.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <CrowdlendingIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No crowdlending loan yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Add each project you lent to, with the amount and the expected refund date. The page shows which refunds are due.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add loan
          </Button>
        </Paper>
      )}

      {loans && loans.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Loan</TableCell>
                <TableCell align="right">Lent</TableCell>
                <TableCell align="right">Still to be refunded</TableCell>
                <TableCell>Refund date</TableCell>
                <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                  Last value
                </TableCell>
                <TableCell align="center">Counted</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loans.map((l) => (
                <TableRow key={l.id} sx={{ opacity: l.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {l.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {l.platform}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(l.lent, l.currency)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {formatMoney(l.outstanding, l.currency)}
                  </TableCell>
                  <TableCell>
                    <DueCell loan={l} />
                  </TableCell>
                  <TableCell align="right" sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    {l.lastValue ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(l.lastValue.usd, 'USD')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMoney(l.lastValue.eur, 'EUR')} · {l.lastValue.date}
                        </Typography>
                        {l.lastValue.stale && (
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
                      checked={l.active}
                      onChange={() => void togglePaused(l)}
                      slotProps={{ input: { 'aria-label': `${l.active ? 'Pause' : 'Resume'} ${l.name}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Edit loan" onClick={() => setEditing(l)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Remove loan" onClick={() => setDeleting(l)}>
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
      <EditDialog loan={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete loan={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
