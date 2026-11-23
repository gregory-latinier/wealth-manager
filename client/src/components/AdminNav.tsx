import { AppBar, Box, Button, Container, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Stack, Toolbar, Tooltip, Typography } from '@mui/material'
import AaveIcon from '@mui/icons-material/AccountBalanceOutlined'
import BankIcon from '@mui/icons-material/AccountBalanceWalletOutlined'
import CrowdlendingIcon from '@mui/icons-material/HandshakeOutlined'
import CryptoIcon from '@mui/icons-material/CurrencyBitcoin'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import DashboardIcon from '@mui/icons-material/DonutLargeOutlined'
import ExchangeIcon from '@mui/icons-material/CurrencyExchange'
import GominingIcon from '@mui/icons-material/MemoryOutlined'
import LeverageIcon from '@mui/icons-material/CandlestickChartOutlined'
import LogoutIcon from '@mui/icons-material/LogoutOutlined'
import SettingsIcon from '@mui/icons-material/SettingsOutlined'
import Mt5Icon from '@mui/icons-material/QueryStatsOutlined'
import StakingIcon from '@mui/icons-material/SavingsOutlined'
import StocksIcon from '@mui/icons-material/ShowChartOutlined'
import { useId, useState, type ReactNode } from 'react'
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
  { section: 'gomining', to: '/admin/gomining', label: 'GoMining', Icon: GominingIcon },
]

// The pages are grouped so the bar stays short. A group with one visible page is a plain link, one with none is left out,
// and a page that is in no group is a plain link too, so a new section never disappears from the bar.
const NAV_GROUPS: Array<{ label: string; Icon: typeof DashboardIcon; sections: Section[] }> = [
  { label: 'Crypto', Icon: CryptoIcon, sections: ['crypto', 'exchanges', 'smardex', 'staking', 'aave', 'gomining'] },
  { label: 'Cash & lending', Icon: BankIcon, sections: ['bank', 'crowdlending'] },
  { label: 'Markets', Icon: StocksIcon, sections: ['stocks', 'mt5'] },
]

type NavLinkDef = { to: string; label: string; Icon: typeof DashboardIcon }
type MenuPlacement = 'top' | 'bottom'

// On phones only the current entry keeps its label, so the floating bar fits the screen.
const pillSx = (current: boolean) => ({
  px: { xs: current ? 2 : 1.25, sm: 2 },
  py: 0.75,
  minWidth: 0,
  color: current ? '#fff' : 'text.secondary',
  backgroundImage: current ? `linear-gradient(180deg, ${VIOLET.buttonTop}, ${VIOLET.buttonBottom})` : 'none',
  boxShadow: current ? 'inset 0 1px 0 rgba(255, 255, 255, 0.28)' : 'none',
  '&:hover': { bgcolor: current ? undefined : 'rgba(255, 255, 255, 0.07)', color: '#fff' },
  '& .MuiButton-startIcon': { mr: { xs: current ? 1 : 0, sm: 1 }, ml: { xs: current ? -0.5 : 0, sm: -0.5 } },
  '& .MuiButton-endIcon': { ml: 0.25, mr: -0.75, display: { xs: current ? 'inherit' : 'none', sm: 'inherit' } },
  '& .pill-label': { display: { xs: current ? 'inline' : 'none', sm: 'inline' } },
})

function NavLink({ to, label, Icon, current }: NavLinkDef & { current: boolean }) {
  return (
    <Button component={RouterLink} to={to} color="inherit" aria-label={label} aria-current={current ? 'page' : undefined} startIcon={<Icon fontSize="small" />} sx={pillSx(current)}>
      <span className="pill-label">{label}</span>
    </Button>
  )
}

/** A pill that opens the pages of one group. It is the current pill when one of its pages is open. */
function NavGroup({ label, Icon, links, pathname, placement }: { label: string; Icon: typeof DashboardIcon; links: NavLinkDef[]; pathname: string; placement: MenuPlacement }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const menuId = useId()
  const current = links.some((l) => l.to === pathname)
  const close = () => setAnchor(null)
  return (
    <>
      <Button
        color="inherit"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor ? 'true' : undefined}
        aria-controls={anchor ? menuId : undefined}
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<Icon fontSize="small" />}
        endIcon={<ExpandMoreIcon fontSize="small" />}
        sx={pillSx(current)}
      >
        <span className="pill-label">{label}</span>
      </Button>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        anchorOrigin={{ vertical: placement, horizontal: 'center' }}
        transformOrigin={{ vertical: placement === 'top' ? 'bottom' : 'top', horizontal: 'center' }}
        slotProps={{ paper: { sx: { mt: placement === 'top' ? -1 : 1, minWidth: 190 } } }}
      >
        {links.map(({ to, label: pageLabel, Icon: PageIcon }) => (
          <MenuItem key={to} component={RouterLink} to={to} selected={to === pathname} aria-current={to === pathname ? 'page' : undefined} onClick={close}>
            <ListItemIcon>
              <PageIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{pageLabel}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

/** Pill-shaped tab bar. The current page, or the group that holds it, is the violet gradient pill. */
function NavPills({ pathname, menuPlacement, sx }: { pathname: string; menuPlacement: MenuPlacement; sx?: object }) {
  const { hiddenSections } = useSettings()
  // A hidden page stays in the bar while it is open, so the owner never lands on a page the menu does not show.
  const visible = SECTION_LINKS.filter((l) => !hiddenSections.includes(l.section) || pathname === l.to)
  const grouped = new Set(NAV_GROUPS.flatMap((g) => g.sections))
  const entries = [
    <NavLink key={DASHBOARD_LINK.to} {...DASHBOARD_LINK} current={pathname === DASHBOARD_LINK.to} />,
    ...NAV_GROUPS.flatMap((group) => {
      const links = visible.filter((l) => group.sections.includes(l.section))
      if (links.length === 0) return []
      if (links.length === 1) return [<NavLink key={links[0]!.to} {...links[0]!} current={pathname === links[0]!.to} />]
      return [<NavGroup key={group.label} label={group.label} Icon={group.Icon} links={links} pathname={pathname} placement={menuPlacement} />]
    }),
    ...visible.filter((l) => !grouped.has(l.section)).map((l) => <NavLink key={l.to} {...l} current={pathname === l.to} />),
  ]
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
      {entries}
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
            <NavPills pathname={pathname} menuPlacement="bottom" />
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
          menuPlacement="top"
          sx={{ pointerEvents: 'auto', bgcolor: 'rgba(21, 15, 34, 0.85)', backdropFilter: 'blur(18px)', boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)' }}
        />
      </Box>
    </>
  )
}
