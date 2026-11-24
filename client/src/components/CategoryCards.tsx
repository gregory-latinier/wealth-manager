import { Box, Paper, Typography } from '@mui/material'
import Grid from '@mui/material/Grid'
import { categoryColor, type BreakdownLine, type Currency } from '../lib/dashboard'
import { srOnly, useCountUp, usePrefersReducedMotion } from '../lib/motion'
import { useMoney } from '../lib/privacy'

const VIOLET_FALLBACK = '#7c4dff'

interface CategoryTotal {
  key: string
  label: string
  value: number
  count: number
}

/** Totals per category, largest first. A negative total (a debt larger than what is held) is kept: it is the honest figure. */
function totals(lines: BreakdownLine[], currency: Currency): CategoryTotal[] {
  const byKey = new Map<string, CategoryTotal>()
  for (const l of lines) {
    const key = l.category
    const entry = byKey.get(key) ?? { key, label: l.categoryLabel, value: 0, count: 0 }
    entry.value += Number(currency === 'USD' ? l.valueUsd : l.valueEur)
    entry.count += 1
    byKey.set(key, entry)
  }
  return [...byKey.values()].sort((a, b) => b.value - a.value)
}

function CategoryCard({ item, share, index, currency }: { item: CategoryTotal; share: number; index: number; currency: Currency }) {
  const { money, hidden } = useMoney()
  const reduced = usePrefersReducedMotion()
  const color = categoryColor(item.key) ?? VIOLET_FALLBACK
  // The count-up is for the eye only. The value is read from `item.value` for assistive tech, so it never announces 40 intermediate figures.
  const shown = useCountUp(item.value)
  const owed = item.value < 0

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        transition: 'transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease',
        // Staggered entrance. `both` keeps the card hidden during its delay, and reduced motion skips it altogether.
        ...(reduced ? {} : { animation: 'wm-card-in 520ms cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: `${index * 90}ms` }),
        '@keyframes wm-card-in': { from: { opacity: 0, transform: 'translateY(14px)' }, to: { opacity: 1, transform: 'none' } },
        '&:hover': reduced ? undefined : { transform: 'translateY(-3px)', borderColor: color, boxShadow: `0 10px 28px -14px ${color}` },
      }}
    >
      {/* Accent edge, in the category's color. */}
      <Box aria-hidden sx={{ position: 'absolute', insetBlock: 0, left: 0, width: 3, bgcolor: color }} />
      <Typography variant="overline" color="text.secondary" component="div" sx={{ lineHeight: 1.6 }}>
        {item.label}
      </Typography>
      <Typography
        component="p"
        sx={{ position: 'relative', fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums', color: owed ? 'error.main' : 'text.primary' }}
      >
        <Box component="span" sx={srOnly}>
          {money(String(item.value), currency)}
        </Box>
        <span aria-hidden>{money(String(shown), currency)}</span>
      </Typography>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.25 }}>
        {item.count} {item.count === 1 ? 'holding' : 'holdings'}
        {!hidden && ` · ${share.toFixed(1)}%`}
      </Typography>

      {/* The bar fills from the left. A negative share is drawn as an empty bar, the red value above says it is owed. */}
      <Box aria-hidden sx={{ height: 6, borderRadius: 3, bgcolor: 'action.hover', overflow: 'hidden' }}>
        <Box
          sx={{
            height: '100%',
            borderRadius: 3,
            bgcolor: color,
            width: `${Math.min(Math.max(share, 0), 100)}%`,
            transformOrigin: 'left',
            ...(reduced ? {} : { animation: 'wm-bar-in 900ms cubic-bezier(0.22, 1, 0.36, 1) both', animationDelay: `${index * 90 + 200}ms` }),
            '@keyframes wm-bar-in': { from: { transform: 'scaleX(0)' }, to: { transform: 'scaleX(1)' } },
          }}
        />
      </Box>
    </Paper>
  )
}

/** One card per category: its total, how many holdings, and its share of what is held. */
export default function CategoryCards({ lines, currency }: { lines: BreakdownLine[]; currency: Currency }) {
  const items = totals(lines, currency)
  if (items.length === 0) return null
  // Shares are of what is held, like the table: dividing by the net worth would pass 100% as soon as something is borrowed.
  const held = items.reduce((sum, i) => sum + Math.max(i.value, 0), 0)

  return (
    <Grid container spacing={2} component="section" aria-label="Value by category">
      {items.map((item, i) => (
        // Keyed by category, so a currency switch keeps the same cards and only their figures glide.
        <Grid key={item.key} size={{ xs: 12, sm: 6, md: Math.max(3, Math.floor(12 / items.length)) }}>
          <CategoryCard item={item} share={held > 0 ? (Math.max(item.value, 0) / held) * 100 : 0} index={i} currency={currency} />
        </Grid>
      ))}
    </Grid>
  )
}
