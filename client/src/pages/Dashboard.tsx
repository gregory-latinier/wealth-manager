import { AppBar, Button, Container, Toolbar, Typography } from '@mui/material'
import { useAuth } from '../lib/auth'

// Placeholder: the real dashboard arrives in T17.
export default function Dashboard() {
  const { logout } = useAuth()
  return (
    <>
      <AppBar position="static" color="default" elevation={0}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Wealth Manager
          </Typography>
          <Button onClick={logout}>Log out</Button>
        </Toolbar>
      </AppBar>
      <Container sx={{ py: 4 }}>
        <Typography color="text.secondary">Nothing tracked yet.</Typography>
      </Container>
    </>
  )
}
