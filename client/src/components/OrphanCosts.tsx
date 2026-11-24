import { Alert, Box, Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { ApiError } from '../lib/api'
import { costApi, type OrphanCost } from '../lib/dashboard'
import { shortAddress } from '../lib/crypto'
import { useMoney } from '../lib/privacy'

/**
 * Costs that were entered for a position which is no longer in the latest snapshot: sold, removed or renamed. They count in no total,
 * so without this list they would sit in the database forever, unseen. Removing one is the owner's call, never automatic: a position
 * can come back (a failed read, a paused address), and its cost with it.
 */
export default function OrphanCosts({ costs, onRemoved }: { costs: OrphanCost[]; onRemoved: () => void }) {
  const { money } = useMoney()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (costs.length === 0) return null

  const remove = async (c: OrphanCost) => {
    const key = `${c.sourceType}:${c.sourceRef}`
    setBusy(key)
    setError(null)
    try {
      await costApi.clear(c.sourceType, c.sourceRef)
      onRemoved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this cost. Try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Alert severity="info" sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {costs.length === 1 ? 'A cost is entered for a position' : `${costs.length} costs are entered for positions`} that{' '}
        {costs.length === 1 ? 'is' : 'are'} not in the latest snapshot. {costs.length === 1 ? 'It counts' : 'They count'} in no total. Remove{' '}
        {costs.length === 1 ? 'it' : 'them'} if the position is gone.
      </Typography>
      {error && (
        <Typography variant="body2" color="error" sx={{ mb: 1 }}>
          {error}
        </Typography>
      )}
      <Stack spacing={0.5}>
        {costs.map((c) => {
          const key = `${c.sourceType}:${c.sourceRef}`
          return (
            <Box key={key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {c.symbol ?? 'Unknown position'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {c.sourceType} · {shortAddress(c.sourceRef)}
              </Typography>
              <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {money(c.cost, c.currency)}
              </Typography>
              <Button size="small" color="error" disabled={busy !== null} onClick={() => void remove(c)} sx={{ ml: 'auto' }}>
                Remove
              </Button>
            </Box>
          )
        })}
      </Stack>
    </Alert>
  )
}
