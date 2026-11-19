import { AppBar, Box, Button, Container, Toolbar, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'

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
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <Typography variant="h6" sx={{ mr: 3 }}>
            Wealth Manager
          </Typography>
          <Box component="nav" aria-label="Main" sx={{ flexGrow: 1, display: 'flex', gap: 1 }}>
            {LINKS.map((link) => (
              <Button
                key={link.to}
                component={RouterLink}
                to={link.to}
                color="inherit"
                aria-current={pathname === link.to ? 'page' : undefined}
                sx={{ fontWeight: pathname === link.to ? 700 : 400 }}
              >
                {link.label}
              </Button>
            ))}
          </Box>
          <Button onClick={logout}>Log out</Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 4 }}>{children}</Container>
    </>
  )
}
