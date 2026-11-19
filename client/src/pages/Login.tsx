import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Box, Button, Container, Paper, TextField, Typography } from '@mui/material'
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
    <Container maxWidth="xs" sx={{ py: 10 }}>
      <Paper component="form" onSubmit={onSubmit} sx={{ p: 4, display: 'grid', gap: 2 }}>
        <Typography variant="h5">Wealth Manager</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          autoFocus
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <Box>
          <Button type="submit" variant="contained" disabled={submitting || !password} fullWidth>
            Sign in
          </Button>
        </Box>
      </Paper>
    </Container>
  )
}
