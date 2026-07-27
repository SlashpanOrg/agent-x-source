/**
 * Observability UI design system — "tactical HUD" theme.
 *
 * Mirrors the main app's military/spy/space command aesthetic (see
 * `styles/settings-theme.ts`) so the standalone Observability window feels
 * like a natural extension of Agent-X rather than a bolted-on admin panel.
 *
 * Colors are consumed as `var(--ax-*)` references via `colors`/`alphaColor`
 * from the shared `theme.ts`, so dark/light switching is zero-cost and stays
 * perfectly in sync with the main console (same `data-ax-scheme` attribute,
 * same `agentx-theme-mode` localStorage key).
 */
import { createTheme } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';
import { theme as appTheme, colors, alphaColor, MONO } from '../theme';

export const obs = {
  bg: {
    void: colors.bg.primary,
    panel: colors.bg.secondary,
    inset: colors.bg.primary,
    elevated: colors.bg.tertiary,
    hover: colors.bg.hover,
    hud: alphaColor(colors.accent.blue, 0.05),
  },
  border: {
    subtle: colors.border.subtle,
    default: colors.border.default,
    strong: colors.border.strong,
    hud: alphaColor(colors.accent.blue, 0.35),
    signal: alphaColor(colors.accent.green, 0.4),
    alert: alphaColor(colors.accent.red, 0.4),
    amber: alphaColor(colors.accent.orange, 0.4),
  },
  accent: {
    hud: colors.accent.blue,
    signal: colors.accent.green,
    amber: colors.accent.orange,
    alert: colors.accent.red,
    purple: colors.accent.purple,
    cyan: colors.accent.cyan,
  },
  text: {
    primary: colors.text.primary,
    secondary: colors.text.secondary,
    tertiary: colors.text.tertiary,
    dim: colors.text.dim,
  },
} as const;

/** Fixed-width icon rail — matches the main console's `layout.sidebarWidth`. */
export const NAV_WIDTH = 48;
export const TOPBAR_HEIGHT = 44;

export const obsMonoSx: SxProps<Theme> = { fontFamily: MONO };

export const obsOverlineSx: SxProps<Theme> = {
  ...obsMonoSx,
  fontSize: '0.56rem',
  fontWeight: 700,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: obs.text.dim,
};

export const obsLabelSx: SxProps<Theme> = {
  ...obsMonoSx,
  fontSize: '0.6rem',
  fontWeight: 600,
  letterSpacing: '0.6px',
  color: obs.text.tertiary,
};

/** Faint animated-feeling scanline overlay — absolutely position inside a `position:relative` parent. */
export const obsScanlineSx: SxProps<Theme> = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  opacity: 0.025,
  backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 2px, ${alphaColor(colors.accent.blue, 0.12)} 2px, ${alphaColor(colors.accent.blue, 0.12)} 3px)`,
};

/** Standard panel/card chrome — compact, bordered, faint scanline. */
export function obsPanelSx(accent?: string): SxProps<Theme> {
  return {
    position: 'relative',
    bgcolor: obs.bg.panel,
    border: `1px solid ${accent ? alphaColor(accent, 0.35) : obs.border.default}`,
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: accent ? `0 0 24px ${alphaColor(accent, 0.08)}` : 'none',
    transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
  };
}

export const obsPanelHeaderSx: SxProps<Theme> = {
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  px: 1.5,
  py: 1,
  borderBottom: `1px solid ${obs.border.subtle}`,
  bgcolor: alphaColor(colors.ink, 0.015),
};

export const obsPanelBodySx: SxProps<Theme> = {
  px: 1.5,
  py: 1.25,
};

/** Small uppercase mono status pill. */
export function obsBadgeSx(state: 'ok' | 'error' | 'running' | 'warn' | 'idle'): SxProps<Theme> {
  const color = state === 'ok' ? obs.accent.signal
    : state === 'error' ? obs.accent.alert
      : state === 'running' ? obs.accent.hud
        : state === 'warn' ? obs.accent.amber
          : obs.text.dim;
  return {
    ...obsMonoSx,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.4,
    fontSize: '0.56rem',
    fontWeight: 700,
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    color,
    px: 0.75,
    py: 0.2,
    border: `1px solid ${alphaColor(color, 0.4)}`,
    borderRadius: '3px',
    bgcolor: alphaColor(color, 0.1),
    lineHeight: 1.6,
    whiteSpace: 'nowrap',
  };
}

export const obsChipSx: SxProps<Theme> = {
  ...obsMonoSx,
  fontSize: '0.6rem',
  height: 20,
  borderRadius: '4px',
  '& .MuiChip-label': { px: 0.75 },
};

export const obsBtnGhostSx: SxProps<Theme> = {
  ...obsMonoSx,
  fontSize: '0.6rem',
  fontWeight: 600,
  letterSpacing: '0.5px',
  textTransform: 'uppercase',
  border: `1px solid ${alphaColor(obs.accent.hud, 0.4)}`,
  color: obs.accent.hud,
  bgcolor: 'transparent',
  px: 1.25,
  py: 0.4,
  minHeight: 26,
  boxShadow: 'none',
  '&:hover': { borderColor: obs.accent.hud, bgcolor: alphaColor(obs.accent.hud, 0.1) },
  '&:disabled': { borderColor: obs.border.default, color: obs.text.dim },
};

export const obsBtnPrimarySx: SxProps<Theme> = {
  ...obsMonoSx,
  fontSize: '0.6rem',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  border: `1px solid ${obs.accent.hud}`,
  bgcolor: obs.accent.hud,
  color: colors.bg.primary,
  px: 1.5,
  py: 0.45,
  minHeight: 26,
  boxShadow: 'none',
  '&:hover': { bgcolor: obs.accent.hud, opacity: 0.9 },
  '&:disabled': { bgcolor: obs.border.default, borderColor: obs.border.default, color: obs.text.dim },
};

export const obsBtnDangerSx: SxProps<Theme> = {
  ...obsBtnGhostSx,
  border: `1px solid ${alphaColor(obs.accent.alert, 0.45)}`,
  color: obs.accent.alert,
  '&:hover': { borderColor: obs.accent.alert, bgcolor: alphaColor(obs.accent.alert, 0.1) },
};

/** Shared log-level → accent color mapping (used by LogRow, LogsPanel, LogHistogram, FilterChips). */
export const LOG_LEVEL_COLORS: Record<string, string> = {
  debug: obs.text.dim,
  info: obs.accent.hud,
  warn: obs.accent.amber,
  error: obs.accent.alert,
};

export const obsInputSx: SxProps<Theme> = {
  '& .MuiOutlinedInput-root': {
    bgcolor: obs.bg.void,
    fontFamily: MONO,
    fontSize: '0.72rem',
    borderRadius: '5px',
  },
  '& .MuiInputLabel-root': { fontFamily: MONO, fontSize: '0.68rem' },
};

/**
 * Extended MUI theme for the standalone Observability window.
 *
 * Built on top of the main app's `theme` (same CSS-var color schemes / mode
 * storage key) with compact, mono-forward, HUD-styled component overrides
 * layered in. Kept in its own theme object (rather than mutating the shared
 * `theme.ts`) so the main console's Settings/Chat/etc. surfaces are unaffected.
 */
export const observabilityTheme = createTheme(appTheme, {
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          border: `1px solid ${obs.border.default}`,
          borderRadius: 8,
        },
      },
    },
    MuiToggleButtonGroup: {
      styleOverrides: {
        root: {
          border: `1px solid ${obs.border.default}`,
          borderRadius: 6,
          gap: 0,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          fontFamily: MONO,
          fontSize: '0.62rem',
          fontWeight: 600,
          letterSpacing: '0.5px',
          textTransform: 'uppercase',
          color: obs.text.dim,
          border: 'none',
          borderRadius: 0,
          padding: '3px 10px',
          minHeight: 24,
          '&.Mui-selected': {
            color: obs.accent.hud,
            backgroundColor: alphaColor(obs.accent.hud, 0.12),
          },
          '&.Mui-selected:hover': { backgroundColor: alphaColor(obs.accent.hud, 0.18) },
          '&:not(:first-of-type)': { borderLeft: `1px solid ${obs.border.default}` },
        },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottomColor: obs.border.subtle,
          fontSize: '0.7rem',
          padding: '6px 10px',
        },
        head: {
          fontFamily: MONO,
          fontSize: '0.58rem',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          color: obs.text.dim,
          backgroundColor: obs.bg.panel,
          whiteSpace: 'nowrap',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-of-type td': { borderBottom: 'none' },
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 36, borderBottom: `1px solid ${obs.border.default}` },
        indicator: { height: 2, backgroundColor: obs.accent.hud },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: MONO,
          fontSize: '0.62rem',
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          minHeight: 36,
          color: obs.text.dim,
          flexShrink: 0,
          '&.Mui-selected': { color: obs.accent.hud },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontFamily: MONO, borderRadius: 4 },
        sizeSmall: { fontSize: '0.6rem', height: 20 },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { fontFamily: MONO, fontSize: '0.72rem', borderRadius: 5 },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          fontFamily: MONO,
          fontWeight: 600,
          letterSpacing: '0.4px',
          textTransform: 'none',
          borderRadius: 5,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none',
          border: 'none',
          borderLeft: `1px solid ${obs.border.default}`,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        root: { fontFamily: MONO, fontSize: '0.68rem', borderRadius: 6 },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: { fontFamily: MONO, fontSize: '0.62rem' },
      },
    },
  },
});
