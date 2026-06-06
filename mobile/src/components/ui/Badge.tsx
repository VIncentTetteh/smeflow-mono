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

interface BadgeProps {
  variant: BadgeVariant;
  label: string;
}

export function Badge({ variant, label }: BadgeProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  const config: { [key in BadgeVariant]: { bg: string; text: string } } = {
    paid: { bg: `${colors.brand}1a`, text: colors.brand },
    pending: { bg: `${colors.gold}33`, text: '#8a6a00' },
    failed: { bg: `${colors.danger}1a`, text: colors.danger },
    synced: { bg: `${colors.info}1a`, text: colors.info },
    offline: { bg: `${colors.ink}14`, text: colors.ink },
    'low-stock': { bg: `${colors.gold}33`, text: '#8a6a00' },
    verified: { bg: `${colors.brand}1a`, text: colors.brand },
    draft: { bg: `${colors.ink}14`, text: colors.ink },
  };

  const { bg, text } = config[variant];

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
