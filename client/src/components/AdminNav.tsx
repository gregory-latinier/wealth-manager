import { AppBar, Box, Button, Container, Stack, Toolbar, Typography } from '@mui/material'
import LogoutIcon from '@mui/icons-material/LogoutOutlined'
import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import Logo from './Logo'

// One entry per admin page. Later source types (aave, forex, bank, stocks) add a line here.
const LINKS = [
  { to: '/', label: 'Dashboard' },
  { to: '/admin/crypto', label: 'Crypto' },
]

/** Page frame: top bar with navigation and logout, then the page content. */
export default function AdminNav({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const { pathname } = useLocation()

  return (
    <>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: { xs: 1, sm: 3 }, minHeight: { xs: 56, sm: 64 } }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
            <Logo size={30} />
            <Typography variant="h6" component="span" sx={{ display: { xs: 'none', sm: 'block' } }}>
              Wealth Manager
            </Typography>
          </Stack>
          <Box component="nav" aria-label="Main" sx={{ flexGrow: 1, display: 'flex', gap: 0.5 }}>
            {LINKS.map((link) => {
              const current = pathname === link.to
              return (
                <Button
                  key={link.to}
                  component={RouterLink}
                  to={link.to}
                  color="inherit"
                  aria-current={current ? 'page' : undefined}
                  sx={{
                    px: 1.75,
                    color: current ? 'primary.main' : 'text.secondary',
                    bgcolor: current ? 'action.selected' : 'transparent',
                    '&:hover': { bgcolor: 'action.hover', color: current ? 'primary.main' : 'text.primary' },
                  }}
                >
                  {link.label}
                </Button>
              )
            })}
          </Box>
          <Button
            onClick={logout}
            color="inherit"
            aria-label="Log out"
            startIcon={<LogoutIcon />}
            sx={{ color: 'text.secondary', minWidth: 0, '& .MuiButton-startIcon': { mx: { xs: 0, sm: undefined } } }}
          >
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              Log out
            </Box>
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 4 } }}>
        {children}
      </Container>
    </>
  )
}
