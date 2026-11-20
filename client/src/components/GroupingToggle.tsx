import { ToggleButton, ToggleButtonGroup } from '@mui/material'
import type { Grouping } from '../lib/dashboard'

/** One switch for the donut and the table: they always group the same way. */
export default function GroupingToggle({ value, onChange }: { value: Grouping; onChange: (next: Grouping) => void }) {
  return (
    <ToggleButtonGroup size="small" exclusive value={value} onChange={(_, v: Grouping | null) => v && onChange(v)} aria-label="Group holdings by">
      <ToggleButton value="asset">By asset</ToggleButton>
      <ToggleButton value="type">By type</ToggleButton>
    </ToggleButtonGroup>
  )
}
