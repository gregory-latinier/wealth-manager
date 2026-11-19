import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import Crypto from './pages/admin/Crypto'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/crypto"
          element={
            <RequireAuth>
              <Crypto />
            </RequireAuth>
          }
        />
        <Route path="*"element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
