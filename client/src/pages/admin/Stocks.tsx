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
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
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
import StocksIcon from '@mui/icons-material/ShowChartOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { formatMoney } from '../../lib/crypto'
import { stocksApi, type SearchResult, type StockHolding } from '../../lib/stocks'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Same rules as the server. A Yahoo Finance ticker has the exchange as its suffix, such as JEQP.DE.
const SYMBOL = /^[A-Za-z0-9][A-Za-z0-9.\-=^]{0,19}$/
// A plain positive number with at most 6 decimals, so fractional shares work.
const QUANTITY = /^\d{1,14}(\.\d{1,6})?$/
const validQuantity = (value: string) => QUANTITY.test(value.trim()) && Number(value) > 0

/** 100.000000 becomes 100 and 12.500000 becomes 12.5. */
const formatQuantity = (value: string) => {
  const [whole, decimals = ''] = value.split('.')
  const trimmed = decimals.replace(/0+$/, '')
  return new Intl.NumberFormat('en').format(BigInt(whole)) + (trimmed ? `.${trimmed}` : '')
}

/** The stored quantity without grouping or trailing zeros, which is what the field accepts back. */
const plainQuantity = (value: string) => {
  const [whole, decimals = ''] = value.split('.')
  const trimmed = decimals.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

// Fund names and brokers come from the owner and the price provider and are rendered as React text, never as HTML.

const SEARCH_DELAY_MS = 500

/** Finds a ticker by fund name, company or ticker. Picking a listing hands its ticker to the form. */
function TickerSearch({ onPick }: { onPick: (symbol: string) => void }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const query = text.trim()
    if (query.length < 2) {
      setResults(null)
      setError(null)
      setSearching(false)
      return
    }
    setSearching(true)
    // The search waits for a pause in typing. A late answer to an older text is dropped.
    let stale = false
    const timer = setTimeout(async () => {
      try {
        const found = (await stocksApi.search(query)).results
        if (!stale) {
          setResults(found)
          setError(null)
        }
      } catch (err) {
        if (!stale) {
          setResults(null)
          setError(errorText(err))
        }
      } finally {
        if (!stale) setSearching(false)
      }
    }, SEARCH_DELAY_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [text])

  const pick = (symbol: string) => {
    onPick(symbol)
    setText('')
  }

  return (
    <Box>
      <TextField
        label="Find by name"
        value={text}
        onChange={(e) => setText(e.target.value)}
        fullWidth
        autoFocus
        autoComplete="off"
        slotProps={{
          htmlInput: { maxLength: 60, spellCheck: false },
          input: { endAdornment: searching ? <InputAdornment position="end"><CircularProgress size={18} /></InputAdornment> : undefined },
        }}
        helperText="A fund or company name, or part of a ticker. Pick a listing to fill the ticker below."
      />
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
      {!searching && results?.length === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Nothing found. Try another name, or type the ticker below.
        </Typography>
      )}
      {results && results.length > 0 && (
        <List dense disablePadding sx={{ mt: 1, border: 1, borderColor: 'divider', borderRadius: 1, maxHeight: 280, overflow: 'auto' }}>
          {results.map((r) => (
            <ListItemButton key={r.symbol} disabled={!r.supported} onClick={() => pick(r.symbol)}>
              <ListItemText
                primary={
                  <>
                    {r.symbol}
                    {r.currency && <Chip size="small" variant="outlined" label={r.currency} sx={{ ml: 1 }} />}
                    {r.supported && r.price && r.currency && (
                      <Typography component="span" variant="body2" color="text.secondary" sx={{ ml: 1 }}>
                        {formatMoney(r.price, r.currency as 'EUR' | 'USD')}
                      </Typography>
                    )}
                  </>
                }
                secondary={`${r.name}${r.exchange ? ` · ${r.exchange}` : ''}${r.reason ? ` · ${r.reason}` : ''}`}
                slotProps={{ primary: { sx: { fontWeight: 600 } } }}
              />
            </ListItemButton>
          ))}
        </List>
      )}
    </Box>
  )
}

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [symbol, setSymbol] = useState('')
  const [broker, setBroker] = useState('')
  const [quantity, setQuantity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setSymbol('')
    setBroker('')
    setQuantity('')
    setError(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await stocksApi.add({ symbol: symbol.trim(), broker: broker.trim(), quantity: quantity.trim() })
      onAdded()
      close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badSymbol = symbol.trim() !== '' && !SYMBOL.test(symbol.trim())
  const badQuantity = quantity.trim() !== '' && !validQuantity(quantity)

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add a stock or ETF</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TickerSearch onPick={setSymbol} />
          <TextField
            label="Ticker"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            required
            error={badSymbol}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 30, spellCheck: false } }}
            helperText={
              badSymbol
                ? 'Letters, digits and . - only'
                : 'The Yahoo Finance ticker with its exchange suffix: JEQP.DE is the Xetra listing in EUR. The name and currency are read from it.'
            }
          />
          <TextField
            label="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            error={badQuantity}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 24 } }}
            helperText={badQuantity ? 'A number greater than 0, with at most 6 decimals' : 'Number of shares, not euros. It is valued at the live price in each snapshot.'}
          />
          <TextField label="Broker" value={broker} onChange={(e) => setBroker(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} helperText="Optional. Where it is held." />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !SYMBOL.test(symbol.trim()) || !validQuantity(quantity)}>
          {busy ? 'Looking up…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function EditDialog({ holding, onClose, onSaved }: { holding: StockHolding | null; onClose: () => void; onSaved: () => void }) {
  const [quantity, setQuantity] = useState('')
  const [broker, setBroker] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setQuantity(holding ? plainQuantity(holding.quantity) : '')
    setBroker(holding?.broker ?? '')
    setError(null)
  }, [holding])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!holding) return
    setBusy(true)
    setError(null)
    try {
      await stocksApi.update(holding.id, { quantity: quantity.trim(), broker: broker.trim() })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badQuantity = quantity.trim() !== '' && !validQuantity(quantity)
  const unchanged = holding !== null && quantity.trim() === plainQuantity(holding.quantity) && broker.trim() === holding.broker

  return (
    <Dialog open={holding !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Edit {holding?.symbol}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            label="Quantity"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
            autoFocus
            error={badQuantity}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 24 } }}
            helperText={badQuantity ? 'A number greater than 0, with at most 6 decimals' : 'Update it when you buy or sell. Past snapshots keep their values.'}
          />
          <TextField label="Broker" value={broker} onChange={(e) => setBroker(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !validQuantity(quantity) || unchanged}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function ConfirmDelete({ holding, onClose, onDeleted }: { holding: StockHolding | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!holding) return
    setBusy(true)
    setError(null)
    try {
      await stocksApi.remove(holding.id)
      onDeleted()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={holding !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Remove this holding?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {holding?.symbol} stops being counted in your net worth. Past snapshots keep their values. To record a sale instead, edit the quantity.
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

export default function Stocks() {
  const [holdings, setHoldings] = useState<StockHolding[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StockHolding | null>(null)
  const [deleting, setDeleting] = useState<StockHolding | null>(null)

  const load = useCallback(async () => {
    try {
      setHoldings((await stocksApi.list()).holdings)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (h: StockHolding) => {
    setActionError(null)
    try {
      await stocksApi.update(h.id, { active: !h.active })
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
            Stocks and ETFs
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Shares you hold at a broker. You enter the quantity, it is valued at the live price in the currency of the listing, EUR or USD.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add holding
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {holdings === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {holdings?.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <StocksIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No stock or ETF yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Add the ticker and how many shares you hold, for example JEQP.DE. Update the quantity whenever you buy or sell.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add holding
          </Button>
        </Paper>
      )}

      {holdings && holdings.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Holding</TableCell>
                <TableCell align="right">Quantity</TableCell>
                <TableCell align="right">Last value</TableCell>
                <TableCell align="center">Counted</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {holdings.map((h) => (
                <TableRow key={h.id} sx={{ opacity: h.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {h.symbol} <Chip size="small" variant="outlined" label={h.currency} sx={{ ml: 0.5 }} />
                    </Typography>
                    <Typography variant="caption" color="text.secondary" component="div">
                      {h.name}
                      {h.broker && ` · ${h.broker}`}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatQuantity(h.quantity)}
                  </TableCell>
                  <TableCell align="right">
                    {h.lastValue ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(h.lastValue.usd, 'USD')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMoney(h.lastValue.eur, 'EUR')} · {h.lastValue.date}
                        </Typography>
                        {h.lastValue.stale && (
                          <Tooltip title="The price or the EUR/USD rate could not be read last time, so the previous value was kept.">
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
                      checked={h.active}
                      onChange={() => void togglePaused(h)}
                      slotProps={{ input: { 'aria-label': `${h.active ? 'Pause' : 'Resume'} ${h.symbol}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Edit holding" onClick={() => setEditing(h)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Remove holding" onClick={() => setDeleting(h)}>
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
      <EditDialog holding={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete holding={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
