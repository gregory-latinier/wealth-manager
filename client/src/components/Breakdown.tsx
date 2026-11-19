import { Box, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography, useTheme } from '@mui/material'
import WarningIcon from '@mui/icons-material/WarningAmberOutlined'
import { formatMoney, shortAddress } from '../lib/crypto'
import type { BreakdownLine, Currency } from '../lib/dashboard'

const BAR = { light: '#2a78d6', dark: '#3987e5' }

/** `eth:0xabc…:native` becomes "Ethereum 0xabc…1234". Unknown source types fall back to the raw ref. */
function describeRef(line: BreakdownLine): string {
  const [chain, address] = line.sourceRef.split(':')
  const name = { btc: 'Bitcoin', eth: 'Ethereum', base: 'Base' }[chain]
  return name && address ? `${name} · ${shortAddress(address)}` : line.sourceRef
}

const trimAmount = (amount: string) => (amount.includes('.') ? amount.replace(/\.?0+$/, '') : amount)

// Every value here is real text in a table, so the breakdown is also the table view of the data.
// Symbols and refs come from stored provider data and are rendered as text, never as HTML.
export default function Breakdown({ lines, currency }: { lines: BreakdownLine[]; currency: Currency }) {
  const theme = useTheme()
  const value = (l: BreakdownLine) => Number(currency === 'USD' ? l.valueUsd : l.valueEur)
  const total = lines.reduce((sum, l) => sum + value(l), 0)

  if (lines.length === 0) return <Typography color="text.secondary">No holdings in this snapshot.</Typography>

  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Asset</TableCell>
            <TableCell align="right">Amount</TableCell>
            <TableCell align="right">Value</TableCell>
            <TableCell sx={{ width: '28%' }}>Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((l) => {
            const share = total > 0 ? (value(l) / total) * 100 : 0
            return (
              <TableRow key={`${l.sourceType}:${l.sourceRef}`}>
                <TableCell>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {l.symbol}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {describeRef(l)}
                  </Typography>
                  {l.stale && (
                    <Tooltip title="The last attempt to read this failed, so the previous value was kept.">
                      <Chip
                        size="small"
                        variant="outlined"
                        icon={<WarningIcon />}
                        label={`Stale since ${l.staleSince ?? 'unknown'}`}
                        sx={{ ml: 1 }}
                      />
                    </Tooltip>
                  )}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {trimAmount(l.amount)}
                </TableCell>
                <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  {formatMoney(currency === 'USD' ? l.valueUsd : l.valueEur, currency)}
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ flexGrow: 1, height: 8 }}>
                      <Box sx={{ width: `${share}%`, height: '100%', bgcolor: BAR[theme.palette.mode], borderRadius: '0 4px 4px 0' }} />
                    </Box>
                    <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {share.toFixed(1)}%
                    </Typography>
                  </Box>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
