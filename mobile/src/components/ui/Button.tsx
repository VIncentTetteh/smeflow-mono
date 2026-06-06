import { TouchableOpacity, ActivityIndicator, StyleSheet, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

type Variant = 'primary' | 'dark' | 'gold' | 'ghost' | 'soft' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: ButtonProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  const bgMap: Record<Variant, string> = {
    primary: colors.brand,
    dark: colors.ink,
    gold: colors.gold,
    ghost: 'transparent',
    soft: `${colors.brand}18`,
    danger: colors.danger,
  };

  const textColorMap: Record<Variant, string> = {
    primary: '#fff',
    dark: '#fff',
    gold: colors.ink,
    ghost: colors.brand,
    soft: colors.brand,
    danger: '#fff',
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        {
          backgroundColor: bgMap[variant],
          borderRadius: radii.md,
          paddingVertical: spacing.md,
          paddingHorizontal: spacing.lg,
          opacity: disabled ? 0.5 : 1,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: variant === 'ghost' ? colors.brand : undefined,
        },
        style,
      ]}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={textColorMap[variant]} />
      ) : (
        <Text
          style={{
            color: textColorMap[variant],
            fontFamily: fonts.bodySemiBold,
            textAlign: 'center',
            fontSize: 16,
          }}
        >
          {label}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center' },
});
