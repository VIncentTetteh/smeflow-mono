import { Pressable, View, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

export type PaymentProvider = 'mtn' | 'telecel' | 'at' | 'cash' | 'ghqr';

interface ProviderChipProps {
  provider: PaymentProvider;
  selected?: boolean;
  disabled?: boolean;
  onPress?: (provider: PaymentProvider) => void;
  style?: ViewStyle;
}

// Single source of truth for MTN/Vodafone(Telecel)/AirtelTigo brand colors —
// also consumed directly by app/owner/payments-history.tsx so both files
// render the same provider colors instead of maintaining separate copies.
export const PAYMENT_PROVIDER_BRAND_COLORS: Record<'mtn' | 'vodafone' | 'airteltigo', string> = {
  mtn: '#f6c600',
  vodafone: '#d71920',
  airteltigo: '#0072ce',
};

const providerConfig: Record<PaymentProvider, { label: string; mark: string; color: string }> = {
  mtn: { label: 'MTN MoMo', mark: 'MTN', color: PAYMENT_PROVIDER_BRAND_COLORS.mtn },
  telecel: { label: 'Telecel Cash', mark: 'TC', color: PAYMENT_PROVIDER_BRAND_COLORS.vodafone },
  at: { label: 'AT Money', mark: 'AT', color: PAYMENT_PROVIDER_BRAND_COLORS.airteltigo },
  cash: { label: 'Cash', mark: 'GHc', color: '#1f6a4f' },
  ghqr: { label: 'GhQR', mark: 'QR', color: '#5b6be5' },
};

export function ProviderChip({
  provider,
  selected,
  disabled,
  onPress,
  style,
}: ProviderChipProps) {
  const { colors, fonts, radii, spacing } = useTheme();
  const config = providerConfig[provider];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={() => onPress?.(provider)}
      style={({ pressed }) => [
        {
          alignItems: 'center',
          backgroundColor: selected ? `${config.color}18` : colors.surface,
          borderColor: selected ? config.color : colors.border,
          borderRadius: radii.full,
          borderWidth: selected ? 1.5 : 1,
          flexDirection: 'row',
          gap: spacing.sm,
          opacity: disabled ? 0.45 : pressed ? 0.75 : 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        style,
      ]}
    >
      <View
        style={{
          alignItems: 'center',
          backgroundColor: config.color,
          borderRadius: 12,
          height: 24,
          justifyContent: 'center',
          width: 24,
        }}
      >
        <Text
          style={{
            color: config.color === PAYMENT_PROVIDER_BRAND_COLORS.mtn ? colors.ink : '#fff',
            fontFamily: fonts.bodySemiBold,
            fontSize: 8,
          }}
        >
          {config.mark}
        </Text>
      </View>
      <Text
        style={{
          color: selected ? config.color : colors.text,
          fontFamily: fonts.bodySemiBold,
          fontSize: 13,
        }}
      >
        {config.label}
      </Text>
    </Pressable>
  );
}
