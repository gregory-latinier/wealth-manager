import { AppBar, Box, Button, Container, IconButton, Stack, Toolbar, Tooltip, Typography } from '@mui/material'
import AaveIcon from '@mui/icons-material/AccountBalanceOutlined'
import BankIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import CrowdlendingIcon from '@mui/icons-material/HandshakeOutlined'
import CryptoIcon from '@mui/icons-material/CurrencyBitcoin'
import DashboardIcon from '@mui/icons-material/DonutLargeOutlined'
import ExchangeIcon from '@mui/icons-material/CurrencyExchange'
import LeverageIcon from '@mui/icons-material/CandlestickChartOutlined'
import LogoutIcon from '@mui/icons-material/LogoutOutlined'
import SettingsIcon from '@mui/icons-material/SettingsOutlined'
import Mt5Icon from '@mui/icons-material/QueryStatsOutlined'
import StakingIcon from '@mui/icons-material/SavingsOutlined'
import StocksIcon from '@mui/icons-material/ShowChartOutlined'
import type { ReactNode } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings, type Section } from '../lib/settings'
import { VIOLET } from '../theme'
import Logo from './Logo'

const DASHBOARD_LINK = { to: '/', label: 'Dashboard', Icon: DashboardIcon }

// One entry per page that can be hidden from the menu. The settings page lists them in this order.
export const SECTION_LINKS: Array<{ section: Section; to: string; label: string; Icon: typeof DashboardIcon }> = [
  { section: 'crypto', to: '/admin/crypto', label: 'Crypto', Icon: CryptoIcon },
  { section: 'exchanges', to: '/admin/exchanges', label: 'Exchanges', Icon: ExchangeIcon },
  { section: 'smardex', to: '/admin/smardex', label: 'Smardex', Icon: LeverageIcon },
  { section: 'staking', to: '/admin/staking', label: 'Staking', Icon: StakingIcon },
  { section: 'aave', to: '/admin/aave', label: 'Aave', Icon: AaveIcon },
  { section: 'bank', to: '/admin/bank', label: 'Bank', Icon: BankIcon },
  { section: 'stocks', to: '/admin/stocks', label: 'Stocks', Icon: StocksIcon },
  { section: 'crowdlending', to: '/admin/crowdlending', label: 'Crowdlending', Icon: CrowdlendingIcon },
  { section: 'mt5', to: '/admin/mt5', label: 'MT5', Icon: Mt5Icon },
]

/** Pill-shaped tab bar. The current page is the violet gradient pill. */
function NavPills({ pathname, sx }: { pathname: string; sx?: object }) {
  const { hiddenSections } = useSettings()
  const links = [DASHBOARD_LINK, ...SECTION_LINKS.filter((l) => !hiddenSections.includes(l.section) || pathname === l.to)]
  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{
        display: 'flex',
        gap: 0.5,
        p: 0.5,
        borderRadius: 999,
        bgcolor: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        ...sx,
      }}
    >
      {links.map(({ to, label, Icon }) => {
        const current = pathname === to
        return (
          <Button
            key={to}
            component={RouterLink}
            to={to}
            color="inherit"
            aria-current={current ? 'page' : undefined}
            startIcon={<Icon fontSize="small" />}
            sx={{
              px: 2,
              py: 0.75,
              color: current ? '#fff' : 'text.secondary',
              backgroundImage: current ? `linear-gradient(180deg, ${VIOLET.buttonTop}, ${VIOLET.buttonBottom})` : 'none',
              boxShadow: current ? 'inset 0 1px 0 rgba(255, 255, 255, 0.28)' : 'none',
              '&:hover': { bgcolor: current ? undefined : 'rgba(255, 255, 255, 0.07)', color: '#fff' },
            }}
          >
            {label}
          </Button>
        )
      })}
    </Box>
  )
}

/** Page frame: glass top bar, the page content, and on phones a floating tab bar at the bottom. */
export default function AdminNav({ children }: { children: ReactNode }) {
  const { logout } = useAuth()
  const { pathname } = useLocation()

  return (
    <>
      <AppBar position="sticky">
        <Toolbar sx={{ gap: { xs: 1, sm: 3 }, minHeight: { xs: 56, sm: 68 } }}>
          <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', flexGrow: { xs: 1, sm: 0 } }}>
            <Logo size={32} />
            <Typography variant="h6" component="span">
              Wealth Manager
            </Typography>
          </Stack>
          <Box sx={{ flexGrow: 1, display: { xs: 'none', sm: 'flex' }, justifyContent: 'center' }}>
            <NavPills pathname={pathname} />
          </Box>
          <Tooltip title="Settings">
            <IconButton
              component={RouterLink}
              to="/admin/settings"
              aria-label="Settings"
              aria-current={pathname === '/admin/settings' ? 'page' : undefined}
              sx={{
                color: pathname === '/admin/settings' ? '#fff' : 'text.secondary',
                bgcolor: pathname === '/admin/settings' ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.06)',
                '&:hover': { color: '#fff', bgcolor: 'rgba(255, 255, 255, 0.12)' },
              }}
            >
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Log out">
            <IconButton
              onClick={logout}
              aria-label="Log out"
              sx={{ color: 'text.secondary', bgcolor: 'rgba(255, 255, 255, 0.06)', '&:hover': { color: '#fff', bgcolor: 'rgba(255, 255, 255, 0.12)' } }}
            >
              <LogoutIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: { xs: 3, sm: 4 }, pb: { xs: 12, sm: 4 } }}>
        {children}
      </Container>

      {/* Phones: floating tab bar, as in the reference. A second copy of the nav, so the first is hidden below sm. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, position: 'fixed', insetInline: 0, bottom: 16, justifyContent: 'center', zIndex: 1100, pointerEvents: 'none' }}>
        <NavPills
          pathname={pathname}
          sx={{ pointerEvents: 'auto', bgcolor: 'rgba(21, 15, 34, 0.85)', backdropFilter: 'blur(18px)', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)' }}
        />
      </Box>
    </>
  )
}
