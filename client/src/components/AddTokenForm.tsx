import { Alert, Button, Stack, TextField } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { ApiError } from '../lib/api'
import { tokenApi, type AddedToken } from '../lib/crypto'

/** Adds an ERC-20 by contract, or a Solana token by mint. The server reads the decimals from the chain. */
export default function AddTokenForm({ addressId, label = 'Token contract address', onAdded }: { addressId: string; label?: string; onAdded: (token: AddedToken) => void }) {
  const [contract, setContract] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setWarning(null)
    try {
      const token = await tokenApi.add(addressId, contract.trim())
      setWarning(token.warning ?? (token.priced === null ? 'Added, but the price could not be checked right now.' : null))
      setContract('')
      onAdded(token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Stack component="form" spacing={1} onSubmit={submit}>
      {error && <Alert severity="error">{error}</Alert>}
      {warning && <Alert severity="warning">{warning}</Alert>}
      <Stack direction="row" spacing={1}>
        <TextField
          size="small"
          fullWidth
          label={label}
          value={contract}
          onChange={(e) => setContract(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 100, spellCheck: false } }}
        />
        <Button type="submit" variant="outlined" disabled={busy || !contract.trim()} sx={{ whiteSpace: 'nowrap' }}>
          Add token
        </Button>
      </Stack>
    </Stack>
  )
}
