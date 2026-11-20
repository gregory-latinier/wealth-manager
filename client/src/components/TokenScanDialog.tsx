import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../lib/api'
import { CHAIN_LABEL, formatMoney, shortAddress, tokenApi, type CryptoAddress, type EvmChain, type HiddenEntry, type ScanEntry, type ScanResult } from '../lib/crypto'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

// Symbols and names come from a third party and are untrusted. They are only ever rendered as React text.

function EntryRow({
  entry,
  checked,
  onToggle,
  action,
}: {
  entry: ScanEntry
  checked: boolean
  onToggle: () => void
  action: { label: string; run: () => void }
}) {
  const secondary = `${entry.name || shortAddress(entry.contract)} · ${entry.balance.replace(/\.?0+$/, '')}${entry.valueUsd ? ` · ${formatMoney(entry.valueUsd, 'USD')}` : ''}`
  return (
    <ListItem disablePadding secondaryAction={<Button size="small" onClick={action.run}>{action.label}</Button>}>
      <ListItemButton onClick={onToggle} disabled={entry.tracked} dense>
        <ListItemIcon>
          <Checkbox edge="start" checked={checked || entry.tracked} disabled={entry.tracked} tabIndex={-1} disableRipple slotProps={{ input: { 'aria-label': `Track ${entry.symbol}` } }} />
        </ListItemIcon>
        <ListItemText primary={entry.tracked ? `${entry.symbol} (already tracked)` : entry.symbol} secondary={secondary} />
      </ListItemButton>
    </ListItem>
  )
}

/** Scans an address and lets the owner pick which tokens to track. */
export default function TokenScanDialog({
  address,
  onClose,
  onChanged,
}: {
  address: CryptoAddress | null
  onClose: () => void
  onChanged: () => void
}) {
  const [result, setResult] = useState<ScanResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showHidden, setShowHidden] = useState(false)
  const [threshold, setThreshold] = useState('')
  const [busy, setBusy] = useState(false)
  const [saveErrors, setSaveErrors] = useState<string[]>([])

  const scan = useCallback(async (addr: CryptoAddress) => {
    setResult(null)
    setError(null)
    try {
      const res = await tokenApi.scan(addr.id)
      setResult(res)
      if (res.status === 'ok') {
        setThreshold(res.thresholdUsd)
        setSelected(new Set(res.selectable.filter((t) => !t.tracked).map((t) => t.contract)))
      }
    } catch (err) {
      setError(errorText(err))
    }
  }, [])

  useEffect(() => {
    setSaveErrors([])
    setShowHidden(false)
    if (address) void scan(address)
  }, [address, scan])

  const toggle = (contract: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(contract)) next.delete(contract)
      else next.add(contract)
      return next
    })

  const act = async (fn: () => Promise<unknown>) => {
    if (!address) return
    setBusy(true)
    setError(null)
    try {
      await fn()
      await scan(address)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const applyThreshold = () => act(async () => void (await tokenApi.setThreshold(threshold.trim())))
  const ignore = (e: ScanEntry) => act(() => tokenApi.ignore(address!.chain as EvmChain, e.contract))
  const unignore = (e: HiddenEntry) =>
    act(async () => {
      const row = (await tokenApi.listIgnored()).find((i) => i.chain === address!.chain && i.contractAddress === e.contract)
      if (row) await tokenApi.unignore(row.id)
    })

  const save = async () => {
    if (!address) return
    setBusy(true)
    setSaveErrors([])
    const failures: string[] = []
    // One at a time: the server reads each token from the chain and rate limits this route.
    for (const contract of selected) {
      try {
        await tokenApi.add(address.id, contract)
      } catch (err) {
        // 409 means it is already tracked, which is the state the owner wanted.
        if (!(err instanceof ApiError && err.status === 409)) failures.push(`${shortAddress(contract)}: ${errorText(err)}`)
      }
    }
    setBusy(false)
    onChanged()
    if (failures.length === 0) onClose()
    else setSaveErrors(failures)
  }

  const ok = result?.status === 'ok' ? result : null

  return (
    <Dialog open={address !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Choose tokens to track</DialogTitle>
      <DialogContent>
        {address && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {address.label ?? shortAddress(address.address)} · {CHAIN_LABEL[address.chain]}
          </Typography>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
        {saveErrors.length > 0 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            Some tokens could not be saved:
            <ul style={{ margin: 0 }}>
              {saveErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          </Alert>
        )}
        {!result && !error && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 4, gap: 1 }}>
            <CircularProgress />
            <Typography variant="body2" color="text.secondary">
              Scanning. Large wallets can take up to a minute.
            </Typography>
          </Box>
        )}
        {result?.status === 'disabled' && <Alert severity="info">{result.reason}</Alert>}

        {ok && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1}>
              <TextField
                size="small"
                label="Minimum value (USD)"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 13 } }}
              />
              <Button onClick={() => void applyThreshold()} disabled={busy || threshold.trim() === ok.thresholdUsd}>
                Apply and rescan
              </Button>
            </Stack>

            <Box>
              <Typography variant="subtitle2">At or above {formatMoney(ok.thresholdUsd, 'USD')}</Typography>
              {ok.selectable.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No token reaches the minimum value.
                </Typography>
              ) : (
                <List dense>
                  {ok.selectable.map((t) => (
                    <EntryRow key={t.contract} entry={t} checked={selected.has(t.contract)} onToggle={() => toggle(t.contract)} action={{ label: 'Ignore', run: () => void ignore(t) }} />
                  ))}
                </List>
              )}
              {ok.belowThresholdCount > 0 && (
                <Typography variant="caption" color="text.secondary">
                  {ok.belowThresholdCount} more below the minimum value.
                </Typography>
              )}
            </Box>

            {ok.unpriced.length > 0 && (
              <Box>
                <Typography variant="subtitle2">{ok.pricesUnavailable ? 'Prices unavailable' : 'No known price'}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {ok.pricesUnavailable
                    ? 'The price service did not answer (it limits free requests), so these tokens could not be valued. Close and scan again in a minute. They are not selected by default.'
                    : 'Tracked tokens without a price count as 0 until a price exists. Not selected by default.'}
                </Typography>
                <List dense>
                  {ok.unpriced.map((t) => (
                    <EntryRow key={t.contract} entry={t} checked={selected.has(t.contract)} onToggle={() => toggle(t.contract)} action={{ label: 'Ignore', run: () => void ignore(t) }} />
                  ))}
                </List>
              </Box>
            )}

            {ok.hidden.length > 0 && (
              <Box>
                <FormControlLabel
                  control={<Switch checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />}
                  label={`Show hidden (${ok.hidden.length} spam or ignored)`}
                />
                {showHidden && (
                  <List dense>
                    {ok.hidden.map((t) => (
                      <EntryRow
                        key={t.contract}
                        entry={t}
                        checked={selected.has(t.contract)}
                        onToggle={() => toggle(t.contract)}
                        action={t.hiddenReason === 'ignored' ? { label: 'Unignore', run: () => void unignore(t) } : { label: 'Ignore', run: () => void ignore(t) }}
                      />
                    ))}
                  </List>
                )}
              </Box>
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {ok ? 'Cancel' : 'Close'}
        </Button>
        {ok && (
          <Button variant="contained" onClick={() => void save()} disabled={busy || selected.size === 0}>
            Track {selected.size} {selected.size === 1 ? 'token' : 'tokens'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
