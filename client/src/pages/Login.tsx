import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Paper, Stack, TextField, Typography } from '@mui/material'
import Logo from '../components/Logo'
import { loginErrorMessage, useAuth } from '../lib/auth'

export default function Login() {
  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const from = (location.state as { from?: string } | null)?.from ?? '/'
  if (status === 'authenticated') return <Navigate to={from} replace />

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(password)
      navigate(from, { replace: true })
    } catch (err) {
      setError(loginErrorMessage(err))
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Paper variant="outlined" component="form" onSubmit={onSubmit} sx={{ width: '100%', maxWidth: 400, p: { xs: 3, sm: 4 }, display: 'grid', gap: 2.5 }}>
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
          <Logo size={56} />
          <Box>
            <Typography variant="h5" component="h1">
              Wealth Manager
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Sign in to see your net worth
            </Typography>
          </Box>
        </Stack>
        {error && <Alert severity="error">{error}</Alert>}
        {/* There is one owner and no username, but password managers only offer to save a login that has a username field. */}
        <input type="text" name="username" value="owner" autoComplete="username" readOnly hidden />
        <TextField
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Button type="submit" variant="contained" size="large" disabled={submitting || !password} fullWidth>
          Sign in
        </Button>
      </Paper>
    </Box>
  )
}
