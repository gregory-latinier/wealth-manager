import { Box, Chip, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip, Typography } from '@mui/material'
import ChevronIcon from '@mui/icons-material/ChevronRight'
import CollapseAllIcon from '@mui/icons-material/UnfoldLessOutlined'
import ExpandAllIcon from '@mui/icons-material/UnfoldMoreOutlined'
import WarningIcon from '@mui/icons-material/WarningAmberOutlined'
import EditIcon from '@mui/icons-material/EditOutlined'
import { Fragment, useState } from 'react'
import { shortAddress } from '../lib/crypto'
import CostDialog from './CostDialog'
import { VIOLET } from '../theme'
import { groupKey, groupLabel, pnlTotal, statusColor, statusLabel, type BreakdownLine, type Currency, type Grouping, type Status } from '../lib/dashboard'
import { useMoney } from '../lib/privacy'

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
  // GoMining refs are `<miner id>:TH` for a miner, and `wallet:BTC` or `wallet:GMT` for the wallet. The miner name is not in the snapshot line.
  if (line.sourceType === 'gomining') return line.sourceRef.startsWith('wallet:') ? 'GoMining wallet' : 'GoMining miner'
  // Aave refs are `<address>:<reserve id>:supply|debt`. A debt line has a negative amount, so "Borrowed" is enough to read it.
  if (line.sourceType === 'aave') {
    const [owner, , side] = line.sourceRef.split(':')
    return `${side === 'debt' ? 'Aave · borrowed' : 'Aave · supplied'} · ${shortAddress(owner)}`
  }
  const [chain, address] = line.sourceRef.split(':')
  // Exchange refs are `kraken:<account id>:BTC`. The account id means nothing to a reader, so only the exchange is shown.
  if (line.sourceType === 'exchange') return EXCHANGE_NAMES[chain] ?? line.sourceRef
  const name = { btc: 'Bitcoin', eth: 'Ethereum', base: 'Base', bsc: 'BNB Chain', arb: 'Arbitrum', sol: 'Solana' }[chain]
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

/** A gain or loss in USD with its percentage, green or red. Shown on a line and on a group, so they read the same. */
function PnlFigure({ pnlUsd, pnlPct }: { pnlUsd: number; pnlPct: number | null }) {
  const { money } = useMoney()
  const color = pnlUsd < 0 ? 'error.main' : pnlUsd > 0 ? 'success.main' : undefined
  return (
    <Box sx={{ textAlign: 'right' }}>
      <Typography variant="body2" sx={{ color }}>
        {pnlUsd > 0 ? '+' : ''}
        {money(String(pnlUsd), 'USD')}
      </Typography>
      {pnlPct !== null && (
        <Typography variant="caption" sx={{ color }}>
          {pnlPct > 0 ? '+' : ''}
          {pnlPct.toFixed(2)}%
        </Typography>
      )}
    </Box>
  )
}

/** Gain or loss of a position against its entered cost, with an edit button. Without a cost, the button invites to enter one. */
function PnlCell({ line, onEdit }: { line: BreakdownLine; onEdit: (line: BreakdownLine) => void }) {
  return (
    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {line.pnlUsd === null ? (
        <Tooltip title="Enter what you paid to see the gain or loss">
          <IconButton size="small" onClick={() => onEdit(line)} aria-label={`Set the cost of ${line.symbol}`}>
            <EditIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <PnlFigure pnlUsd={Number(line.pnlUsd)} pnlPct={line.pnlPct === null ? null : Number(line.pnlPct)} />
          <IconButton size="small" onClick={() => onEdit(line)} aria-label={`Change the cost of ${line.symbol}`}>
            <EditIcon fontSize="inherit" />
          </IconButton>
        </Box>
      )}
    </TableCell>
  )
}

/** Total gain of a set of lines. Only lines with a cost are counted, and it says how many, so a partial total is never read as a whole one. */
function PnlTotalCell({ lines }: { lines: BreakdownLine[] }) {
  const total = pnlTotal(lines)
  return (
    <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {total && (
        <Tooltip title={total.counted === total.total ? 'Every holding here has a cost.' : `Only ${total.counted} of these ${total.total} holdings have a cost entered.`}>
          <Box sx={{ display: 'inline-block' }}>
            <PnlFigure pnlUsd={total.pnlUsd} pnlPct={total.pnlPct} />
            {total.counted !== total.total && (
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 400 }}>
                {total.counted}/{total.total} with cost
              </Typography>
            )}
          </Box>
        </Tooltip>
      )}
    </TableCell>
  )
}

const staleChip = (staleSince: string | null) => (
  <Tooltip title="The last attempt to read this failed, so the previous value was kept.">
    <Chip size="small" variant="outlined" icon={<WarningIcon />} label={`Stale since ${staleSince ?? 'unknown'}`} sx={{ ml: 1 }} />
  </Tooltip>
)

/** A small tag for a holding that cannot be used freely. Available is the normal case, so it gets no tag. */
const statusTag = (status: Status) =>
  status === 'available' ? null : (
    <Chip size="small" variant="outlined" label={statusLabel(status)} sx={{ ml: 1, height: 20, fontSize: 11, color: statusColor(status), borderColor: statusColor(status) }} />
  )

// Layout of the first column, in px. The table cells pad 8px on a phone and 16px above, and a group row starts with a chevron button
// followed by its label. Lines are placed from these numbers so they line up with that label instead of an eyeballed value.
const CELL_PAD = { xs: 8, sm: 16 }
const CHEVRON = 28
const CHEVRON_GAP = 4
const NESTED_INDENT = 16
const fromCell = (extra: number) => ({ xs: `${CELL_PAD.xs + extra}px`, sm: `${CELL_PAD.sm + extra}px` })

/**
 * One holding. `nested` lines sit under a group row: they are indented past the group label, with a guide line under the chevron
 * and a faint background. `aligned` lines are not in a group, but other rows are, so their text is lined up with the group labels.
 * By asset a nested line is the same coin as its group, so it is named by where it is held instead of repeating the symbol.
 */
function LineRow({
  line,
  currency,
  total,
  nested,
  aligned = false,
  grouping,
  onEdit,
}: {
  line: BreakdownLine
  currency: Currency
  total: number
  nested: boolean
  aligned?: boolean
  grouping: Grouping
  onEdit: (line: BreakdownLine) => void
}) {
  const { money } = useMoney()
  const amountValue = currency === 'USD' ? line.valueUsd : line.valueEur
  const share = total > 0 ? (Number(amountValue) / total) * 100 : 0
  const byLocation = nested && grouping === 'asset'
  return (
    <TableRow sx={nested ? { bgcolor: 'rgba(255, 255, 255, 0.025)' } : undefined}>
      <TableCell
        sx={
          nested
            ? {
                position: 'relative',
                // `&&` doubles the class: the table sets `& td { px }`, which is more specific than a single class and would win.
                '&&': { pl: fromCell(CHEVRON + CHEVRON_GAP + NESTED_INDENT) },
                // Vertical guide under the middle of the chevron, so a line visibly belongs to the group above it.
                '&::before': { content: '""', position: 'absolute', top: 0, bottom: 0, left: fromCell(CHEVRON / 2), width: '1px', bgcolor: 'divider' },
              }
            : aligned
              ? { '&&': { pl: fromCell(CHEVRON + CHEVRON_GAP) } }
              : undefined
        }
      >
        <Typography variant="body2" sx={{ fontWeight: nested ? 500 : 600 }}>
          {byLocation ? describeRef(line) : line.symbol}
        </Typography>
        {!byLocation && (
          <Typography variant="caption" color="text.secondary">
            {describeRef(line)}
          </Typography>
        )}
        {/* Under a status group the group row already says it, so the tag is only for the other groupings. */}
        {grouping !== 'status' && statusTag(line.status)}
        {line.stale && staleChip(line.staleSince)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', display: { xs: 'none', sm: 'table-cell' } }}>
        {trimAmount(line.amount)}
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {money(amountValue, currency)}
        {/* The Amount column is hidden on phones, so the amount moves under the value. */}
        <Typography variant="caption" color="text.secondary" component="div" sx={{ display: { xs: 'block', sm: 'none' } }}>
          {trimAmount(line.amount)} {line.symbol}
        </Typography>
      </TableCell>
      <PnlCell line={line} onEdit={onEdit} />
      <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
        <ShareBar share={share} />
      </TableCell>
    </TableRow>
  )
}

// Every value here is real text in a table, so the breakdown is also the table view of the data.
// Symbols and refs come from stored provider data and are rendered as text, never as HTML.
export default function Breakdown({ lines, currency, grouping, onCostChange }: { lines: BreakdownLine[]; currency: Currency; grouping: Grouping; onCostChange: () => void }) {
  const { money } = useMoney()
  const [editing, setEditing] = useState<BreakdownLine | null>(null)
  // Which groups are open, per grouping. By category and by type open everything (there are few groups), by asset starts closed.
  const [toggled, setToggled] = useState<Record<string, boolean>>({})

  if (lines.length === 0) return <Typography color="text.secondary">No holdings in this snapshot.</Typography>

  const groups = groupLines(lines, currency, grouping)
  const overall = pnlTotal(lines)
  // Shares are of what is held. Dividing by the net worth would push every share past 100% as soon as something is borrowed.
  const total = groups.reduce((sum, g) => sum + Math.max(g.value, 0), 0)
  const isOpen = (g: Group) => toggled[`${grouping}:${g.key}`] ?? grouping !== 'asset'
  const toggle = (g: Group) => setToggled((t) => ({ ...t, [`${grouping}:${g.key}`]: !isOpen(g) }))
  // Only groups with a row of their own can be open. A single-line asset has nothing to collapse.
  const expandable = groups.filter((g) => grouping !== 'asset' || g.lines.length > 1)
  // When some rows have a chevron, the ones without must leave the same room, or the first column zigzags.
  const hasGroupRows = expandable.length > 0
  const anyOpen = expandable.some(isOpen)
  const allOpen = expandable.every(isOpen)
  const setAll = (open: boolean) => setToggled((t) => ({ ...t, ...Object.fromEntries(expandable.map((g) => [`${grouping}:${g.key}`, open])) }))

  return (
    <>
      <CostDialog line={editing} onClose={() => setEditing(null)} onSaved={onCostChange} />
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
                {{ asset: 'Asset', category: 'Category', type: 'Type', status: 'Status' }[grouping]}
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
            <TableCell align="right">
              <Tooltip title="Value minus what you paid, in USD. Use the pencil on a row to enter the cost.">
                <span>P/L</span>
              </Tooltip>
            </TableCell>
            <TableCell sx={{ width: '28%', display: { xs: 'none', md: 'table-cell' } }}>Share</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {groups.map((g) => {
            // By asset, an asset held in one place needs no group row. By type the group row is always shown.
            if (grouping === 'asset' && g.lines.length === 1) return <LineRow key={g.key} line={g.lines[0]} currency={currency} total={total} nested={false} aligned={hasGroupRows} grouping={grouping} onEdit={setEditing} />

            const open = isOpen(g)
            const share = total > 0 ? (g.value / total) * 100 : 0
            const staleCount = g.lines.filter((l) => l.stale).length
            // By asset every line is the same coin, so the amounts add up. By category or type they are different assets and do not.
            const amount = grouping === 'asset' ? g.lines.reduce((sum, l) => sum + Number(l.amount), 0) : null
            return (
              <Fragment key={g.key}>
                <TableRow sx={{ '& td': { fontWeight: 600 } }}>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: `${CHEVRON_GAP}px` }}>
                      <IconButton
                        size="small"
                        onClick={() => toggle(g)}
                        aria-expanded={open}
                        aria-label={`${open ? 'Hide' : 'Show'} the ${g.lines.length} holdings of ${g.label}`}
                        sx={{ width: CHEVRON, height: CHEVRON, p: 0, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 150ms' }}
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
                    {money(String(g.value), currency)}
                  </TableCell>
                  <PnlTotalCell lines={g.lines} />
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <ShareBar share={share} />
                  </TableCell>
                </TableRow>
                {open && g.lines.map((l) => <LineRow key={`${l.sourceType}:${l.sourceRef}`} line={l} currency={currency} total={total} nested grouping={grouping} onEdit={setEditing} />)}
              </Fragment>
            )
          })}
        </TableBody>
      </Table>
      </TableContainer>
      {overall && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 2, px: { xs: 1, sm: 2 }, pt: 1.5 }}>
          <Typography variant="body2" color="text.secondary">
            Total gain or loss
            {overall.counted !== overall.total && ` (${overall.counted} of ${overall.total} holdings with a cost)`}
          </Typography>
          <PnlFigure pnlUsd={overall.pnlUsd} pnlPct={overall.pnlPct} />
        </Box>
      )}
    </>
  )
}
