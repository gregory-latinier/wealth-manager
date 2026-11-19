import { createTheme } from '@mui/material/styles'

const FONT = '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

// One brand blue (the logo's), cool neutral surfaces, hairline borders instead of shadows.
// Light primary is a step darker than the chart blue so white button text clears 4.5:1.
export const theme = createTheme({
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#2570c9' },
        success: { main: '#1a7f4b' },
        error: { main: '#c4301f' },
        warning: { main: '#9a5b00' },
        background: { default: '#f3f5f9', paper: '#ffffff' },
        text: { primary: '#121a26', secondary: '#566275' },
        divider: '#e2e7ef',
      },
    },
    dark: {
      palette: {
        primary: { main: '#5b9cf0' },
        success: { main: '#4cc38a' },
        error: { main: '#f0786a' },
        warning: { main: '#e0a23a' },
        background: { default: '#0d1117', paper: '#151b24' },
        text: { primary: '#e8edf5', secondary: '#9aa7ba' },
        divider: '#252d3a',
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT,
    h5: { fontWeight: 700, letterSpacing: '-0.01em' },
    h6: { fontWeight: 650, letterSpacing: '-0.005em' },
    subtitle1: { fontWeight: 650 },
    overline: { fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 10 } },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.palette.background.paper,
          backgroundImage: 'none',
          borderBottom: `1px solid ${theme.palette.divider}`,
          color: theme.palette.text.primary,
        }),
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: ({ theme }) => ({ borderColor: theme.palette.divider }),
        head: ({ theme }) => ({
          color: theme.palette.text.secondary,
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          whiteSpace: 'nowrap',
        }),
      },
    },
    MuiDialog: { styleOverrides: { paper: { borderRadius: 16 } } },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 700 } } },
    MuiToggleButton: {
      styleOverrides: { root: { textTransform: 'none', fontWeight: 600, paddingInline: 14 } },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
})
