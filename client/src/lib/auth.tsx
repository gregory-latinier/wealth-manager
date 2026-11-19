import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { Box, Button, CircularProgress, Typography } from '@mui/material'
import { api, ApiError } from './api'

// 'unreachable' means the server could not answer, which says nothing about the session: the cookie stays valid.
type Status = 'loading' | 'authenticated' | 'anonymous' | 'unreachable'

interface AuthContextValue {
  status: Status
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
  retry: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')

  const check = useCallback(() => {
    setStatus('loading')
    api('/api/auth/me')
      .then(() => setStatus('authenticated'))
      // Only a 401 means "not logged in". A network error or a 5xx (for example the app waking up) must not log the owner out.
      .catch((err) => setStatus(err instanceof ApiError && err.status === 401 ? 'anonymous' : 'unreachable'))
  }, [])

  useEffect(check, [check])

  const login = useCallback(async (password: string) => {
    await api('/api/auth/login', { method: 'POST', body: { password } })
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    setStatus('anonymous')
  }, [])

  const value = useMemo(() => ({ status, login, logout, retry: check }), [status, login, logout, check])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** Wraps the pages that need a logged-in owner and sends everyone else to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, retry } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (status === 'unreachable') {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', gap: 2, py: 8, px: 2, textAlign: 'center' }}>
        <Typography>Could not reach the server. You are still signed in.</Typography>
        <Button variant="contained" onClick={retry}>
          Try again
        </Button>
      </Box>
    )
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <>{children}</>
}

export function loginErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Wrong password.'
    if (err.status === 429) return 'Too many attempts. Wait a minute and try again.'
  }
  return 'Could not reach the server.'
}
