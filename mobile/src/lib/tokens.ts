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

export type ColorScheme = 'warm' | 'dark';
