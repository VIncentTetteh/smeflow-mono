import { colors, fonts, spacing, radii, type ColorScheme } from './tokens';
import { useUIStore } from '@/store/ui';

export function useTheme() {
  const scheme = useUIStore((s) => s.theme) as ColorScheme;
  const isDark = scheme === 'dark';

  return {
    isDark,
    colors: {
      ...colors,
      bg:      isDark ? colors.dark.bg      : colors.bg,
      surface: isDark ? colors.dark.surface : colors.surface,
      ink:     isDark ? colors.dark.ink     : colors.ink,
      muted:   isDark ? colors.dark.muted   : colors.muted,
      border:  isDark ? colors.dark.border  : colors.border,
      text:    isDark ? colors.dark.ink     : colors.ink,
      // Inverted "accent" surface (dark card/button that carries LIGHT text) —
      // must NOT theme-swap, or in dark mode it turns cream and its light text
      // becomes invisible. Always the dark ink; `onInverse` is its light text.
      inverse:   colors.ink,       // #2a2a22 in both modes
      onInverse: colors.dark.ink,  // #f5efe1 light text for inverse surfaces
    },
    fonts,
    spacing,
    radii,
  };
}
