import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import Aave from './pages/admin/Aave'
import Crypto from './pages/admin/Crypto'
import Exchanges from './pages/admin/Exchanges'
import Smardex from './pages/admin/Smardex'
import Staking from './pages/admin/Staking'
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
        <Route
          path="/admin/exchanges"
          element={
            <RequireAuth>
              <Exchanges />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/smardex"
          element={
            <RequireAuth>
              <Smardex />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/aave"
          element={
            <RequireAuth>
              <Aave />
            </RequireAuth>
          }
        />
        <Route
          path="/admin/staking"
          element={
            <RequireAuth>
              <Staking />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
