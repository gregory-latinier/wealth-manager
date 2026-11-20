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
  FormControlLabel,
  IconButton,
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
import StakingIcon from '@mui/icons-material/SavingsOutlined'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import AdminNav from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { formatMoney, shortAddress } from '../../lib/crypto'
import { stakingApi, type RewardsSettings, type StakingPosition } from '../../lib/staking'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
// Same rule as the server: a plain positive number, no exponent, up to 18 decimals.
const AMOUNT = /^\d{1,20}(\.\d{1,18})?$/
const validAmount = (value: string) => AMOUNT.test(value.trim()) && Number(value) > 0

/** 10000000.000000000000000000 becomes 10,000,000. Trailing zeros of the decimals are dropped. */
const formatAmount = (value: string) => {
  const [whole, decimals = ''] = value.split('.')
  const trimmed = decimals.replace(/0+$/, '')
  return new Intl.NumberFormat('en').format(BigInt(whole)) + (trimmed ? `.${trimmed}` : '')
}

// Platform names come from the owner and are rendered as React text, never as HTML.

/** Optional: read what the staking contract says the wallet can claim, and count it. The contract is checked when it is saved. */
function RewardsFields({
  enabled,
  onToggle,
  contract,
  onContract,
  wallet,
  onWallet,
}: {
  enabled: boolean
  onToggle: (on: boolean) => void
  contract: string
  onContract: (value: string) => void
  wallet: string
  onWallet: (value: string) => void
}) {
  const badContract = contract.trim() !== '' && !EVM_ADDRESS.test(contract.trim())
  const badWallet = wallet.trim() !== '' && !EVM_ADDRESS.test(wallet.trim())
  return (
    <Box>
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => onToggle(e.target.checked)} />}
        label="Also count the rewards I can claim"
      />
      {enabled && (
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label="Staking contract"
            value={contract}
            onChange={(e) => onContract(e.target.value)}
            required
            error={badContract}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 100, spellCheck: false } }}
            helperText={badContract ? '0x followed by 40 hex characters' : 'The contract the tokens are staked in. It must answer getClaimableRewards(address).'}
          />
          <TextField
            label="Your wallet"
            value={wallet}
            onChange={(e) => onWallet(e.target.value)}
            required
            error={badWallet}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 100, spellCheck: false } }}
            helperText={badWallet ? '0x followed by 40 hex characters' : 'The address that staked. Rewards change every second, so they are read from the chain at each snapshot.'}
          />
        </Stack>
      )}
    </Box>
  )
}

/** The rewards to send, or undefined when switched off, or null as "incomplete". */
const rewardsOf = (enabled: boolean, contract: string, wallet: string): RewardsSettings | undefined | null => {
  if (!enabled) return undefined
  return EVM_ADDRESS.test(contract.trim()) && EVM_ADDRESS.test(wallet.trim()) ? { contract: contract.trim(), wallet: wallet.trim() } : null
}

function AddDialog({ open, onClose, onAdded }: { open: boolean; onClose: () => void; onAdded: () => void }) {
  const [platform, setPlatform] = useState('')
  const [contract, setContract] = useState('')
  const [amount, setAmount] = useState('')
  const [rewardsOn, setRewardsOn] = useState(false)
  const [rewardsContract, setRewardsContract] = useState('')
  const [rewardsWallet, setRewardsWallet] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const close = () => {
    setPlatform('')
    setContract('')
    setAmount('')
    setRewardsOn(false)
    setRewardsContract('')
    setRewardsWallet('')
    setError(null)
    setWarning(null)
    onClose()
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const rewards = rewardsOf(rewardsOn, rewardsContract, rewardsWallet) ?? undefined
      const added = await stakingApi.add({ platform: platform.trim(), contract: contract.trim(), amount: amount.trim(), rewards })
      onAdded()
      // A token without a price is still saved. Keep the dialog open once so the warning is read.
      if (added.warning && !warning) setWarning(added.warning)
      else close()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badContract = contract.trim() !== '' && !EVM_ADDRESS.test(contract.trim())
  const badAmount = amount.trim() !== '' && !validAmount(amount)

  if (warning) {
    return (
      <Dialog open={open} onClose={close}>
        <DialogTitle>Added, but not valued yet</DialogTitle>
        <DialogContent>
          <DialogContentText>{warning}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={close}>OK</Button>
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="sm" component="form" onSubmit={submit}>
      <DialogTitle>Add a staked token</DialogTitle>
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
            helperText="Where the tokens are locked, for example Everything."
          />
          <TextField
            label="Token contract (Ethereum)"
            value={contract}
            onChange={(e) => setContract(e.target.value)}
            required
            error={badContract}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 100, spellCheck: false } }}
            helperText={badContract ? '0x followed by 40 hex characters' : 'The ERC-20 contract of the staked token. Its symbol is read from the chain. SDEX: 0x5de8ab7e27f6e7a1fff3e5b337584aa43961beef'}
          />
          <TextField
            label="Amount staked"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            error={badAmount}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 40 } }}
            helperText={badAmount ? 'A number greater than 0, without separators' : 'Number of tokens, not dollars. It is valued at the live price in each snapshot.'}
          />
          <RewardsFields
            enabled={rewardsOn}
            onToggle={setRewardsOn}
            contract={rewardsContract}
            onContract={setRewardsContract}
            wallet={rewardsWallet}
            onWallet={setRewardsWallet}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="contained"
          disabled={busy || !platform.trim() || !EVM_ADDRESS.test(contract.trim()) || !validAmount(amount) || rewardsOf(rewardsOn, rewardsContract, rewardsWallet) === null}
        >
          {busy ? 'Adding…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function EditDialog({ position, onClose, onSaved }: { position: StakingPosition | null; onClose: () => void; onSaved: () => void }) {
  const [platform, setPlatform] = useState('')
  const [amount, setAmount] = useState('')
  const [rewardsOn, setRewardsOn] = useState(false)
  const [rewardsContract, setRewardsContract] = useState('')
  const [rewardsWallet, setRewardsWallet] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setPlatform(position?.platform ?? '')
    setAmount(position ? formatPlain(position.amount) : '')
    setRewardsOn(position?.rewardsContract != null)
    setRewardsContract(position?.rewardsContract ?? '')
    setRewardsWallet(position?.rewardsWallet ?? '')
    setError(null)
  }, [position])

  const rewards = rewardsOf(rewardsOn, rewardsContract, rewardsWallet)
  const rewardsChanged =
    position !== null &&
    (rewardsOn
      ? rewards !== null && (rewards?.contract.toLowerCase() !== position.rewardsContract || rewards?.wallet.toLowerCase() !== position.rewardsWallet)
      : position.rewardsContract !== null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!position) return
    setBusy(true)
    setError(null)
    try {
      await stakingApi.update(position.id, {
        platform: platform.trim(),
        amount: amount.trim(),
        // Sent only when changed, so saving a new amount never re-checks the contract. Off sends null.
        ...(rewardsChanged ? { rewards: rewardsOn ? (rewards ?? undefined) : null } : {}),
      })
      onSaved()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const badAmount = amount.trim() !== '' && !validAmount(amount)
  const unchanged = platform.trim() === position?.platform && amount.trim() === (position ? formatPlain(position.amount) : '') && !rewardsChanged

  return (
    <Dialog open={position !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs" component="form" onSubmit={submit}>
      <DialogTitle>Edit {position?.symbol} stake</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Platform" value={platform} onChange={(e) => setPlatform(e.target.value)} required slotProps={{ htmlInput: { maxLength: 100 } }} />
          <TextField
            label="Amount staked"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            autoFocus
            error={badAmount}
            autoComplete="off"
            slotProps={{ htmlInput: { inputMode: 'decimal', maxLength: 40 } }}
            helperText={badAmount ? 'A number greater than 0, without separators' : 'Update it when you stake or unstake more. Past snapshots keep their values.'}
          />
          <RewardsFields
            enabled={rewardsOn}
            onToggle={setRewardsOn}
            contract={rewardsContract}
            onContract={setRewardsContract}
            wallet={rewardsWallet}
            onWallet={setRewardsWallet}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="contained" disabled={busy || !platform.trim() || !validAmount(amount) || unchanged || rewards === null}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/** The stored amount without grouping or trailing zeros, which is what the field accepts back. */
function formatPlain(value: string) {
  const [whole, decimals = ''] = value.split('.')
  const trimmed = decimals.replace(/0+$/, '')
  return trimmed ? `${whole}.${trimmed}` : whole
}

function ConfirmDelete({ position, onClose, onDeleted }: { position: StakingPosition | null; onClose: () => void; onDeleted: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!position) return
    setBusy(true)
    setError(null)
    try {
      await stakingApi.remove(position.id)
      onDeleted()
      onClose()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={position !== null} onClose={busy ? undefined : onClose}>
      <DialogTitle>Remove this stake?</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <DialogContentText>
          {position?.symbol} on {position?.platform} stops being counted in your net worth. Past snapshots keep their values. To record an unstake instead, edit the
          amount.
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

export default function Staking() {
  const [positions, setPositions] = useState<StakingPosition[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<StakingPosition | null>(null)
  const [deleting, setDeleting] = useState<StakingPosition | null>(null)

  const load = useCallback(async () => {
    try {
      setPositions((await stakingApi.list()).positions)
      setLoadError(null)
    } catch (err) {
      setLoadError(errorText(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const togglePaused = async (p: StakingPosition) => {
    setActionError(null)
    try {
      await stakingApi.update(p.id, { active: !p.active })
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
            Staking
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Tokens locked on a platform that has no way to be read automatically. You enter the amount, it is valued at the live token price.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
          Add stake
        </Button>
      </Stack>

      {loadError && <Alert severity="error" sx={{ mb: 2 }}>{loadError}</Alert>}
      {actionError && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setActionError(null)}>{actionError}</Alert>}

      {positions === null && !loadError && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {positions?.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 4, sm: 8 }, textAlign: 'center' }}>
          <Box sx={{ display: 'inline-grid', placeItems: 'center', width: 64, height: 64, borderRadius: '50%', bgcolor: 'action.selected', color: 'primary.main', mb: 2 }}>
            <StakingIcon fontSize="large" aria-hidden />
          </Box>
          <Typography variant="h6" component="h2" gutterBottom>
            No staked token yet
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 440, mx: 'auto', mb: 3 }}>
            Add the token, the platform and how many tokens are staked. Update the amount whenever it changes.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            Add stake
          </Button>
        </Paper>
      )}

      {positions && positions.length > 0 && (
        <TableContainer component={Paper} variant="outlined">
          <Table sx={{ '& tbody tr:last-child td': { borderBottom: 0 }, '& th, & td': { px: { xs: 1, sm: 2 } } }}>
            <TableHead>
              <TableRow>
                <TableCell>Stake</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell align="right">Last value</TableCell>
                <TableCell align="center">Counted</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((p) => (
                <TableRow key={p.id} sx={{ opacity: p.active ? 1 : 0.6 }}>
                  <TableCell>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {p.symbol} · {p.platform}
                    </Typography>
                    <Tooltip title={p.contract}>
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ fontFamily: 'monospace' }}>
                        {shortAddress(p.contract)}
                      </Typography>
                    </Tooltip>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatAmount(p.amount)} {p.symbol}
                  </TableCell>
                  <TableCell align="right">
                    {p.lastValue ? (
                      <>
                        <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                          {formatMoney(p.lastValue.usd, 'USD')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatMoney(p.lastValue.eur, 'EUR')} · {p.lastValue.date}
                        </Typography>
                        {p.lastValue.stale && (
                          <Tooltip title="The price could not be read last time, so the previous value was kept.">
                            <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />
                          </Tooltip>
                        )}
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        Not in a snapshot yet
                      </Typography>
                    )}
                    {p.rewardsContract !== null && (
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
                        {p.rewardsLastValue ? `+ ${formatMoney(p.rewardsLastValue.usd, 'USD')} claimable` : '+ claimable rewards, not in a snapshot yet'}
                        {p.rewardsLastValue?.stale && <Chip size="small" color="warning" label="stale" sx={{ ml: 1 }} />}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={p.active}
                      onChange={() => void togglePaused(p)}
                      slotProps={{ input: { 'aria-label': `${p.active ? 'Pause' : 'Resume'} ${p.symbol} on ${p.platform}` } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="Edit stake" onClick={() => setEditing(p)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton aria-label="Remove stake" onClick={() => setDeleting(p)}>
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
      <EditDialog position={editing} onClose={() => setEditing(null)} onSaved={() => void load()} />
      <ConfirmDelete position={deleting} onClose={() => setDeleting(null)} onDeleted={() => void load()} />
    </AdminNav>
  )
}
