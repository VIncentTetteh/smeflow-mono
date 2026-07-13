import { View, StyleSheet } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

type BadgeVariant =
  | 'paid'
  | 'pending'
  | 'failed'
  | 'synced'
  | 'offline'
  | 'low-stock'
  | 'verified'
  | 'draft';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

interface BadgeProps {
  variant?: BadgeVariant;
  tone?: BadgeTone;
  label: string;
}

export function Badge({ variant, tone, label }: BadgeProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  const variantConfig: { [key in BadgeVariant]: { bg: string; text: string } } = {
    paid: { bg: `${colors.brand}1a`, text: colors.brand },
    pending: { bg: `${colors.gold}33`, text: '#8a6a00' },
    failed: { bg: `${colors.danger}1a`, text: colors.danger },
    synced: { bg: `${colors.info}1a`, text: colors.info },
    offline: { bg: `${colors.ink}14`, text: colors.ink },
    'low-stock': { bg: `${colors.gold}33`, text: '#8a6a00' },
    verified: { bg: `${colors.brand}1a`, text: colors.brand },
    draft: { bg: `${colors.ink}14`, text: colors.ink },
  };

  // Tone mirrors the fg/bg convention already established by the home-screen
  // AlertRow component (app/owner/index.tsx) so status coloring is identical
  // wherever it appears in the app.
  const toneConfig: { [key in BadgeTone]: { bg: string; text: string } } = {
    success: { bg: `${colors.brand}15`, text: colors.brand },
    warning: { bg: `${colors.gold}18`, text: colors.gold },
    danger: { bg: `${colors.danger}15`, text: colors.danger },
    info: { bg: `${colors.info}15`, text: colors.info },
    neutral: { bg: `${colors.ink}10`, text: colors.muted },
  };

  const { bg, text } = tone ? toneConfig[tone] : variantConfig[variant ?? 'draft'];

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderRadius: radii.full,
          paddingHorizontal: spacing.sm,
          paddingVertical: spacing.xs,
        },
      ]}
    >
      <Text style={{ color: text, fontSize: 11, fontFamily: fonts.bodySemiBold }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { alignSelf: 'flex-start' },
});
