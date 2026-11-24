import { Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, TextField } from '@mui/material'
import { useEffect, useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import { costApi, type BreakdownLine } from '../lib/dashboard'

// Same rule as the server: USD, 0 or more, at most 8 decimals.
const COST = /^\d{1,19}(\.\d{1,8})?$/

/** Sets, changes or clears what was paid for one position, in USD. The gain or loss is worked out from it by the server. */
export default function CostDialog({ line, onClose, onSaved }: { line: BreakdownLine | null; onClose: () => void; onSaved: () => void }) {
  const [cost, setCost] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Shown without trailing zeros, as the owner would type it.
    setCost(line?.costUsd ? line.costUsd.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '')
    setError(null)
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
    if (line) void run(() => costApi.set(line.sourceType, line.sourceRef, cost.trim()))
  }

  const bad = cost.trim() !== '' && !COST.test(cost.trim())

  return (
    <Dialog open={line !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Cost of {line?.symbol}</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ mb: 2 }}>
          The total you paid for the whole position, in USD (not a price per unit). The gain or loss is the value minus this cost. Enter 0 for an airdrop.
        </DialogContentText>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <TextField
          autoFocus
          fullWidth
          label="Total cost (USD)"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          error={bad}
          helperText={bad ? 'A number of USD, 0 or more, with at most 8 decimals' : ' '}
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
        />
      </DialogContent>
      <DialogActions>
        {line?.costUsd != null && (
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
