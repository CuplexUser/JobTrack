import { theme, type ThemeConfig } from 'antd';

export type ThemeMode = 'dark' | 'light';

/**
 * A layered neutral base (not flat black in dark, not flat white in light) plus a single
 * accent blue, modeled on GitHub's Primer palette. The previous theme paired AntD's dark
 * algorithm defaults (bodies drop to near-black) with a brand indigo (`#4f46e5`) that is
 * itself quite dark — the two together left almost no contrast between accent and
 * background. GitHub's accent (`#58a6ff` dark / `#0969da` light) is picked specifically to
 * read clearly against its own near-black canvas, so it replaces the indigo everywhere the
 * indigo was carrying contrast rather than just brand color.
 *
 * Two representations of the same palette, kept in step:
 *   - HEX_PALETTES below, which Ant Design needs as real colors (it derives hover/active
 *     shades from them with color math, which a `var()` string would break);
 *   - the `--jt-*` custom properties in index.css, which is what `palette` resolves to.
 * Components import `palette` and get variables, so they follow the theme without knowing it.
 */
export const HEX_PALETTES: Record<ThemeMode, Record<string, string>> = {
  dark: {
    bgBase: '#0d1117',
    bgRaised: '#161b22',
    bgSunken: '#010409',
    border: '#30363d',
    borderStrong: '#444c56',
    textPrimary: '#e6edf3',
    textMuted: '#8b949e',
    textFaint: '#6e7681',
    accent: '#58a6ff',
    success: '#3fb950',
    danger: '#f85149',
    warning: '#d29922',
  },
  light: {
    bgBase: '#ffffff',
    bgRaised: '#ffffff',
    bgSunken: '#f6f8fa',
    border: '#d0d7de',
    borderStrong: '#afb8c1',
    textPrimary: '#1f2328',
    textMuted: '#656d76',
    textFaint: '#8c959f',
    accent: '#0969da',
    success: '#1a7f37',
    danger: '#d1242f',
    warning: '#9a6700',
  },
};

export const palette = {
  bgBase: 'var(--jt-bg-base)',
  bgRaised: 'var(--jt-bg-raised)',
  bgSunken: 'var(--jt-bg-sunken)',
  border: 'var(--jt-border)',
  borderStrong: 'var(--jt-border-strong)',
  textPrimary: 'var(--jt-text-primary)',
  textMuted: 'var(--jt-text-muted)',
  textFaint: 'var(--jt-text-faint)',
  accent: 'var(--jt-accent)',
  success: 'var(--jt-success)',
  danger: 'var(--jt-danger)',
  warning: 'var(--jt-warning)',
} as const;

export function buildAntdTheme(mode: ThemeMode): ThemeConfig {
  const p = HEX_PALETTES[mode];
  return {
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    token: {
      colorBgBase: p.bgBase,
      colorBgContainer: p.bgRaised,
      colorBgElevated: p.bgRaised,
      colorBgLayout: p.bgBase,
      colorBorder: p.border,
      colorBorderSecondary: p.border,
      colorText: p.textPrimary,
      colorTextSecondary: p.textMuted,
      colorTextTertiary: p.textFaint,
      colorPrimary: p.accent,
      colorLink: p.accent,
      colorSuccess: p.success,
      colorError: p.danger,
      colorWarning: p.warning,
      borderRadius: 8,
      fontSize: 14,
    },
    components: {
      Layout: {
        siderBg: p.bgSunken,
        headerBg: p.bgSunken,
        bodyBg: p.bgBase,
      },
    },
  };
}
