export const colors = {
  ink: '#2a2a22',
  brand: '#1f6a4f',
  gold: '#e8c25a',
  danger: '#d03514',
  info: '#5b6be5',
  bg: '#faf8f3',
  surface: '#ffffff',
  muted: '#6b6860',
  border: '#e8e5de',
  dark: {
    bg: '#1a1a14',
    surface: '#252520',
    ink: '#f5efe1',
    muted: '#9a9690',
    border: '#3a3a32',
  },
} as const;

export const fonts = {
  display: 'SourceSerif4_400Regular',
  displaySemiBold: 'SourceSerif4_600SemiBold',
  body: 'Inter_400Regular',
  bodySemiBold: 'Inter_600SemiBold',
  mono: 'JetBrainsMono_400Regular',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  full: 999,
} as const;

// Decorative-only palette for rotating cart-tile swatches (e.g. cashier quick-tap
// grid). Not semantic — do not map these to BadgeTone/status meaning.
export const categoryTileColors = [
  '#dc2626', '#0f6d4f', '#d4a23a', '#1d4ed8',
  '#7c2d12', '#0891b2', '#a16207', '#92400e',
  '#15803d', '#b91c1c', '#6b6860', '#1f6a4f',
] as const;

export type ColorScheme = 'warm' | 'dark';
