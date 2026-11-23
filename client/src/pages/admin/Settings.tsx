import { Alert, Box, Paper, Stack, Switch, Typography } from '@mui/material'
import { useState } from 'react'
import AdminNav, { SECTION_LINKS } from '../../components/AdminNav'
import { ApiError } from '../../lib/api'
import { useSettings, type Section } from '../../lib/settings'

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

export default function Settings() {
  const { hiddenSections, setHidden } = useSettings()
  const [error, setError] = useState<string | null>(null)

  const toggle = async (section: Section, hidden: boolean) => {
    setError(null)
    try {
      await setHidden(section, hidden)
    } catch (err) {
      setError(errorText(err))
    }
  }

  return (
    <AdminNav>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" component="h1">
          Settings
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Choose the pages you want in the menu. Hiding a page only removes it from the menu: whatever it tracks is still counted in your net worth, and the page stays
          reachable at its address.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Paper variant="outlined">
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: 'divider' }} />}>
          {SECTION_LINKS.map(({ section, label, Icon }) => {
            const shown = !hiddenSections.includes(section)
            return (
              <Stack key={section} direction="row" sx={{ alignItems: 'center', gap: 2, px: 2, py: 1 }}>
                <Icon fontSize="small" aria-hidden />
                <Typography sx={{ flexGrow: 1 }}>{label}</Typography>
                <Switch checked={shown} onChange={() => void toggle(section, shown)} slotProps={{ input: { 'aria-label': `${shown ? 'Hide' : 'Show'} ${label} in the menu` } }} />
              </Stack>
            )
          })}
        </Stack>
      </Paper>
    </AdminNav>
  )
}
