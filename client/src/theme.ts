import { createTheme } from '@mui/material/styles'

const FONT = '"Inter Variable", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

/** Shared with charts and the logo so every violet on screen comes from one place. */
export const VIOLET = {
  accent: '#a78bfa',
  main: '#8b5cf6',
  deep: '#7c4dff',
  buttonTop: '#9164ff',
  buttonBottom: '#7a4af0',
}

// Deep violet-to-black backdrop, glass cards with hairline borders, one gradient pill for the primary action.
// Dark only: the whole look depends on the gradient behind the glass.
export const theme = createTheme({
  defaultColorScheme: 'dark',
  colorSchemes: {
    dark: {
      palette: {
        primary: { main: VIOLET.main, light: VIOLET.accent, dark: VIOLET.deep, contrastText: '#ffffff' },
        success: { main: '#4cd9a0' },
        error: { main: '#ff7b8a' },
        warning: { main: '#f2b04a' },
        info: { main: '#8fb4ff' },
        background: { default: '#0b0614', paper: '#150f22' },
        text: { primary: '#f4f0fb', secondary: '#a9a1bd' },
        divider: 'rgba(255, 255, 255, 0.09)',
      },
    },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily: FONT,
    h5: { fontWeight: 700, letterSpacing: '-0.015em' },
    h6: { fontWeight: 650, letterSpacing: '-0.01em' },
    subtitle1: { fontWeight: 650 },
    overline: { fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          minHeight: '100dvh',
          backgroundColor: '#0b0614',
          backgroundImage: 'radial-gradient(110% 55% at 50% -8%, #4b2b8f 0%, #22123f 38%, #0b0614 78%)',
          backgroundAttachment: 'fixed',
          backgroundRepeat: 'no-repeat',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: { backgroundImage: 'none' },
        // Cards are the outlined variant: dark glass with a violet glow at the top edge.
        outlined: {
          backgroundColor: 'rgba(21, 15, 34, 0.72)',
          backgroundImage: 'linear-gradient(180deg, rgba(139, 92, 246, 0.16) 0%, rgba(255, 255, 255, 0.025) 48%)',
          borderColor: 'rgba(255, 255, 255, 0.09)',
          borderRadius: 24,
          backdropFilter: 'blur(14px)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999 },
        contained: {
          backgroundImage: `linear-gradient(180deg, ${VIOLET.buttonTop}, ${VIOLET.buttonBottom})`,
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.28)',
          '&:hover': { backgroundImage: `linear-gradient(180deg, #a074ff, ${VIOLET.deep})` },
          '&.Mui-disabled': { backgroundImage: 'none' },
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: {
          backgroundColor: 'rgba(11, 6, 20, 0.55)',
          backgroundImage: 'none',
          backdropFilter: 'blur(18px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.07)',
          color: '#f4f0fb',
        },
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
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 24,
          backgroundColor: '#1a1229',
          backgroundImage: 'linear-gradient(180deg, rgba(139, 92, 246, 0.18), rgba(255, 255, 255, 0.02) 40%)',
          border: '1px solid rgba(255, 255, 255, 0.09)',
        },
      },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontWeight: 700 } } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { borderRadius: 14, backgroundColor: 'rgba(255, 255, 255, 0.04)' },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: { backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 999, padding: 3, gap: 2 },
        grouped: {
          border: 0,
          borderRadius: 999,
          '&:not(:first-of-type), &:not(:last-of-type)': { borderRadius: 999 },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          paddingInline: 14,
          color: '#a9a1bd',
          '&.Mui-selected': {
            color: '#ffffff',
            backgroundImage: `linear-gradient(180deg, ${VIOLET.buttonTop}, ${VIOLET.buttonBottom})`,
            '&:hover': { backgroundImage: `linear-gradient(180deg, #a074ff, ${VIOLET.deep})` },
          },
        },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
})
