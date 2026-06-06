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
    },
    fonts,
    spacing,
    radii,
  };
}
