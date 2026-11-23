import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './lib/auth'
import { SettingsProvider } from './lib/settings'
import Aave from './pages/admin/Aave'
import Bank from './pages/admin/Bank'
import Crowdlending from './pages/admin/Crowdlending'
import Mt5 from './pages/admin/Mt5'
import Crypto from './pages/admin/Crypto'
import Exchanges from './pages/admin/Exchanges'
import Settings from './pages/admin/Settings'
import Smardex from './pages/admin/Smardex'
import Staking from './pages/admin/Staking'
import Stocks from './pages/admin/Stocks'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'

export default function App() {
  return (
    <AuthProvider>
      <SettingsProvider>
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
          <Route
            path="/admin/bank"
            element={
              <RequireAuth>
                <Bank />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/crowdlending"
            element={
              <RequireAuth>
                <Crowdlending />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/mt5"
            element={
              <RequireAuth>
                <Mt5 />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <RequireAuth>
                <Settings />
              </RequireAuth>
            }
          />
          <Route
            path="/admin/stocks"
            element={
              <RequireAuth>
                <Stocks />
              </RequireAuth>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SettingsProvider>
    </AuthProvider>
  )
}
