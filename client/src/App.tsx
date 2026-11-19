import { useEffect, useState } from 'react'
import { Alert, Container, Typography } from '@mui/material'

type Health = { status: string; db: string }

export default function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(String(err)))
  }, [])

  return (
    <Container maxWidth="sm" sx={{ py: 6 }}>
      <Typography variant="h4" gutterBottom>
        Wealth Manager
      </Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {health && (
        <Alert severity={health.status === 'ok' ? 'success' : 'warning'}>
          Server: {health.status}, database: {health.db}
        </Alert>
      )}
    </Container>
  )
}
