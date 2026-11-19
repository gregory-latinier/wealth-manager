import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/DeleteOutlined'
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { shortAddress, tokenApi, type CryptoAddress, type TrackedToken } from '../lib/crypto'
import AddTokenForm from './AddTokenForm'

/** Tokens tracked on one EVM address: pause, delete, add by contract, or open the scan. */
export default function TrackedTokensDialog({
  address,
  onClose,
  onScan,
}: {
  address: CryptoAddress | null
  onClose: () => void
  onScan: (address: CryptoAddress) => void
}) {
  const [tokens, setTokens] = useState<TrackedToken[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (a: CryptoAddress) => {
    try {
      setTokens(await tokenApi.list(a.id))
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }, [])

  useEffect(() => {
    setTokens(null)
    setError(null)
    if (address) void load(address)
  }, [address, load])

  const run = async (fn: () => Promise<unknown>) => {
    if (!address) return
    setError(null)
    try {
      await fn()
      await load(address)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.')
    }
  }

  return (
    <Dialog open={address !== null} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Tracked tokens</DialogTitle>
      <DialogContent>
        {address && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {address.label ?? shortAddress(address.address)}
          </Typography>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {tokens === null && !error && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress />
          </Box>
        )}
        {tokens?.length === 0 && <Typography color="text.secondary">No token tracked on this address.</Typography>}
        {tokens && tokens.length > 0 && address && (
          <List dense>
            {tokens.map((t) => (
              <ListItem
                key={t.id}
                secondaryAction={
                  <Stack direction="row" sx={{ alignItems: 'center' }}>
                    <Switch
                      checked={t.active}
                      onChange={() => void run(() => tokenApi.setActive(address.id, t.id, !t.active))}
                      slotProps={{ input: { 'aria-label': `${t.active ? 'Pause' : 'Resume'} ${t.symbol}` } }}
                    />
                    <IconButton aria-label={`Stop tracking ${t.symbol}`} onClick={() => void run(() => tokenApi.remove(address.id, t.id))}>
                      <DeleteIcon />
                    </IconButton>
                  </Stack>
                }
              >
                <ListItemText primary={t.symbol} secondary={shortAddress(t.contractAddress)} sx={{ opacity: t.active ? 1 : 0.6 }} />
              </ListItem>
            ))}
          </List>
        )}
        {address && (
          <Stack spacing={2} sx={{ mt: 2 }}>
            <AddTokenForm addressId={address.id} onAdded={() => void load(address)} />
            <Box>
              <Button variant="outlined" onClick={() => onScan(address)}>
                Scan for tokens
              </Button>
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
