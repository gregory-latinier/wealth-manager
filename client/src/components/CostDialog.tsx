import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, MenuItem, Stack, TextField } from '@mui/material'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import { costApi, type BreakdownLine, type Currency } from '../lib/dashboard'

// Same rule as the server: 0 or more, at most 8 decimals.
const COST = /^\d{1,19}(\.\d{1,8})?$/

/**
 * Sets, changes or clears what was paid for one position, in USD or EUR. It is kept in the currency typed, never converted when
 * saved, and the gain or loss is worked out from it by the server. A new cost starts in `defaultCurrency`, the one being displayed.
 */
export default function CostDialog({
  line,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  line: BreakdownLine | null
  defaultCurrency: Currency
  onClose: () => void
  onSaved: () => void
}) {
  const [cost, setCost] = useState('')
  const [currency, setCurrency] = useState<Currency>(defaultCurrency)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Shown without trailing zeros, as the owner would type it.
    setCost(line?.cost ? line.cost.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '')
    // An existing cost keeps the currency it was typed in. Only a new one follows the display.
    setCurrency(line?.costCurrency ?? defaultCurrency)
    setError(null)
    // Reset when another line is opened, not when the display currency changes under an open dialog.
  }, [line])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (line) void run(() => costApi.set(line.sourceType, line.sourceRef, cost.trim(), currency))
  }

  const bad = cost.trim() !== '' && !COST.test(cost.trim())

  return (
    <Dialog open={line !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Cost of {line?.symbol}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          The total you paid for the whole position (not a price per unit), in the currency you paid in. It is kept as typed, and converted with the day's rate to show the gain or loss in the other currency. Enter 0 for an airdrop.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Stack direction="row" spacing={1.5}>
          <TextField
            autoFocus
            fullWidth
            label="Total cost"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            error={bad}
            helperText={bad ? 'A number, 0 or more, with at most 8 decimals' : ' '}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as Currency)} sx={{ minWidth: 110 }}>
            <MenuItem value="USD">USD</MenuItem>
            <MenuItem value="EUR">EUR</MenuItem>
          </TextField>
        </Stack>
      </DialogContent>
      <DialogActions>
        {line?.cost != null && (
          <Button color="error" disabled={busy} onClick={() => line && void run(() => costApi.clear(line.sourceType, line.sourceRef))} sx={{ mr: 'auto' }}>
            Remove cost
          </Button>
        )}
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || bad || cost.trim() === ''}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}
