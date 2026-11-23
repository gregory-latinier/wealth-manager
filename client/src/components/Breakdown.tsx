import { Box, Chip, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import ChevronIcon from '@mui/icons-material/ChevronRight'
import CollapseAllIcon from '@mui/icons-material/UnfoldLessOutlined'
import ExpandAllIcon from '@mui/icons-material/UnfoldMoreOutlined'
import WarningIcon from '@mui/icons-material/WarningAmberOutlined'
import { Fragment, useState } from 'react'
import { formatMoney, shortAddress } from '../lib/crypto'
import { VIOLET } from '../theme'
import { groupKey, groupLabel, type BreakdownLine, type Currency, type Grouping } from '../lib/dashboard'

const EXCHANGE_NAMES: Record<string, string> = { kraken: 'Kraken', okx: 'OKX' }

/** `eth:0xabc…:native` becomes "Ethereum 0xabc…1234". Unknown source types fall back to the raw ref. */
function describeRef(line: BreakdownLine): string {
  // Smardex refs are `<address>:<tick>:<tickVersion>:<index>`. The address comes first, so it must be handled before the chain split.
  if (line.sourceType === 'smardex') {
    const [owner, tick] = line.sourceRef.split(':')
    return `Leveraged long · ${shortAddress(owner)} · tick ${tick}`
  }
  // Staking refs are `<position id>:SYMBOL`, or `<position id>:rewards` for the claimable rewards. The id means nothing to a reader,
  // and the platform is not in the snapshot line.
  if (line.sourceType === 'staking') return line.sourceRef.endsWith(':rewards') ? 'Staking · claimable rewards' : 'Staked'
  // Bank refs are `<account id>:EUR|USD`. The account name is not in the snapshot line, so the currency is what can be shown.
  if (line.sourceType === 'bank') return `Bank account · ${line.sourceRef.split(':')[1] ?? ''}`.replace(/ · $/, '')
  // Stocks refs are `<holding id>:<TICKER>`. The ticker is already the symbol of the row, and the id means nothing to a reader.
  if (line.sourceType === 'stocks') return 'Stock or ETF'
  // Crowdlending refs are `<loan id>:EUR`. The loan name is not in the snapshot line.
  if (line.sourceType === 'crowdlending') return 'Crowdlending loan'
  // MT5 refs are `<login>:EUR|USD`. The account name is not in the snapshot line, so the login is what can be shown.
  if (line.sourceType === 'mt5') return `MT5 account ${line.sourceRef.split(':')[0]}`
  // Aave refs are `<address>:<reserve id>:supply|debt`. A debt line has a negative amount, so "Borrowed" is enough to read it.
  if (line.sourceType === 'aave') {
    const [owner, , side] = line.sourceRef.split(':')
    return `${side === 'debt' ? 'Aave · borrowed' : 'Aave · supplied'} · ${shortAddress(owner)}`
  }
  const [chain, address] = line.sourceRef.split(':')
  // Exchange refs are `kraken:<account id>:BTC`. The account id means nothing to a reader, so only the exchange is shown.
  if (line.sourceType === 'exchange') return EXCHANGE_NAMES[chain] ?? line.sourceRef
  const name = { btc: 'Bitcoin', eth: 'Ethereum', base: 'Base', bsc: 'BNB Chain' }[chain]
  return name && address ? `${name} · ${shortAddress(address)}` : line.sourceRef
}

const trimAmount = (amount: string) => (amount.includes('.') ? amount.replace(/\.?0+$/, '') : amount)

interface Group {
  key: string
  label: string
  lines: BreakdownLine[]
  value: number
}

/** Groups the lines, largest group first and largest line first inside each. */
function groupLines(lines: BreakdownLine[], currency: Currency, grouping: Grouping): Group[] {
  const value = (l: BreakdownLine) => Number(currency === 'USD' ? l.valueUsd : l.valueEur)
  const byKey = new Map<string, Group>()
  for (const l of lines) {
    const key = groupKey(l, grouping)
    const group = byKey.get(key) ?? { key, label: groupLabel(l, grouping), lines: [], value: 0 }
    group.lines.push(l)
    group.value += value(l)
    byKey.set(key, group)
  }
  const groups = [...byKey.values()]
  for (const g of groups) g.lines.sort((a, b) => value(b) - value(a))
  return groups.sort((a, b) => b.value - a.value)
}

/** A negative share (a debt) is drawn as a red bar of the same length, so it never gets a negative width. */
function ShareBar({ share }: { share: number }) {
  const owed = share < 0
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Box sx={{ flexGrow: 1, height: 8, borderRadius: 4, bgcolor: 'action.hover' }}>
        <Box
          sx={{
            width: `${Math.min(Math.abs(share), 100)}%`,
            height: '100%',
            backgroundImage: owed ? 'none' : `linear-gradient(90deg, ${VIOLET.deep}, ${VIOLET.accent})`,
            bgcolor: owed ? 'error.main' : undefined,
            borderRadius: 4,
          }}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {share.toFixed(1)}%
      </Typography>
    </Box>
  )
}

const staleChip = (staleSince: string | null) => (
  <Tooltip title="The last attempt to read this failed, so the previous value was kept.">
    <Chip size="small" variant="outlined" icon={<WarningIcon />} label={`Stale since ${staleSince ?? 'unknown'}`} sx={{ ml: 1 }} />
  </Tooltip>
)

/** One holding. Inside a group it is indented under the group row. */
function LineRow({ line, currency, total, nested }: { line: BreakdownLine; currency: Currency; total: number; nested: boolean }) {
  const amountValue = currency === 'USD' ? line.valueUsd : line.valueEur
  const share = total > 0 ? (Number(amountValue) / total) * 100 : 0
  return (
    <TableRow>
      <TableCell sx={nested ? { pl: { xs: 4, sm: 7 } } : undefined}>
        <Typography variant="body2" sx={{ fontWeight: nested ? 500 : 600 }}>
          {line.symbol}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {describeRef(line)}
        </Typography>
        {line.stale && staleChip(line.staleSince)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', display: { xs: 'none', sm: 'table-cell' } }}>
        {trimAmount(line.amount)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(amountValue, currency)}
        {/* The Amount column is hidden on phones, so the amount moves under the value. */}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ display: { xs: 'block', sm: 'none' } }}>
          {trimAmount(line.amount)} {line.symbol}
        </Typography>
      </TableCell>
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
        <ShareBar share={share} />
      </TableCell>
    </TableRow>
  )
}

// Every value here is real text in a table, so the breakdown is also the table view of the data.
// Symbols and refs come from stored provider data and are rendered as text, never as HTML.
export default function Breakdown({ lines, currency, grouping }: { lines: BreakdownLine[]; currency: Currency; grouping: Grouping }) {
  // Which groups are open, per grouping. By type opens everything (there are few groups), by asset starts closed.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  if (lines.length === 0) return <Typography color="text.secondary">No holdings in this snapshot.</Typography>

  const groups = groupLines(lines, currency, grouping)
  // Shares are of what is held. Dividing by the net worth would push every share past 100% as soon as something is borrowed.
  const total = groups.reduce((sum, g) => sum + Math.max(g.value, 0), 0)
  const isOpen = (g: Group) => toggled[`${grouping}:${g.key}`] ?? grouping === 'type'
  const toggle = (g: Group) => setToggled((t) => ({ ...t, [`${grouping}:${g.key}`]: !isOpen(g) }))
  // Only groups with a row of their own can be open. A single-line asset has nothing to collapse.
  const expandable = groups.filter((g) => grouping === 'type' || g.lines.length > 1)
  const anyOpen = expandable.some(isOpen)
  const allOpen = expandable.every(isOpen)
  const setAll = (open: boolean) => setToggled((t) => ({ ...t, ...Object.fromEntries(expandable.map((g) => [`${grouping}:${g.key}`, open])) }))

  return (
    <TableContainer>
      <Table
        sx={{
          '& tbody tr:last-child td': { borderBottom: 0 },
          '& tbody tr:hover': { bgcolor: 'action.hover' },
          '& th, & td': { px: { xs: 1, sm: 2 } },
        }}
      >
        <TableHead>
          <TableRow>
            <TableCell>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {grouping === 'type' ? 'Type' : 'Asset'}
                {/* The spans keep the tooltips working while a button is disabled. */}
                <Tooltip title="Expand all">
                  <span>
                    <IconButton size="small" onClick={() => setAll(true)} disabled={allOpen} aria-label="Expand all groups">
                      <ExpandAllIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Collapse all">
                  <span>
                    <IconButton size="small" onClick={() => setAll(false)} disabled={!anyOpen} aria-label="Collapse all groups">
                      <CollapseAllIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            </TableCell>
            <TableCell align="right" sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
              Amount
            </TableCell>
            <TableCell align="right">Value</TableCell>
            <TableCell sx={{ width: '28%', display: { xs: 'none', md: 'table-cell' } }}>Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            // By asset, an asset held in one place needs no group row. By type the group row is always shown.
            if (grouping === 'asset' && g.lines.length === 1) return <LineRow key={g.key} line={g.lines[0]} currency={currency} total={total} nested={false} />

            const open = isOpen(g)
            const share = total > 0 ? (g.value / total) * 100 : 0
            const staleCount = g.lines.filter((l) => l.stale).length
            // By asset every line is the same coin, so the amounts add up. By type they are different assets and do not.
            const amount = grouping === 'asset' ? g.lines.reduce((sum, l) => sum + Number(l.amount), 0) : null
            return (
              <Fragment key={g.key}>
                <TableRow sx={{ '& td': { fontWeight: 600 } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <IconButton
                        size="small"
                        onClick={() => toggle(g)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} the ${g.lines.length} holdings of ${g.label}`}
                        sx={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
                      >
                        <ChevronIcon fontSize="small" />
                      </IconButton>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                          {g.label}
                          {staleCount > 0 && (
                            <Tooltip title={`${staleCount} of these could not be read last time, so their previous value was kept.`}>
                              <WarningIcon fontSize="small" color="warning" sx={{ ml: 1, verticalAlign: 'text-bottom' }} aria-label="Contains stale values" />
                            </Tooltip>
                          )}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 400 }}>
                          {g.lines.length} {g.lines.length === 1 ? 'holding' : 'holdings'}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', display: { xs: 'none', sm: 'table-cell' } }}>
                    {amount !== null ? amount.toLocaleString('en', { maximumFractionDigits: 8 }) : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatMoney(String(g.value), currency)}
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <ShareBar share={share} />
                  </TableCell>
                </TableRow>
                {open && g.lines.map((l) => <LineRow key={`${l.sourceType}:${l.sourceRef}`} line={l} currency={currency} total={total} nested />)}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
