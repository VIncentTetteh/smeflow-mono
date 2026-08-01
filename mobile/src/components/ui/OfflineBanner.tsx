import { View, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';

interface OfflineBannerProps {
  style?: ViewStyle;
}

export function OfflineBanner({ style }: OfflineBannerProps) {
  const { colors, fonts, radii, spacing } = useTheme();
  const isOffline = useUIStore((state) => state.isOffline);
  const pendingCount = useSyncStore((state) => state.pendingCount);

  if (!isOffline && pendingCount === 0) {
    return null;
  }

  const queuedLabel =
    pendingCount === 1 ? '1 action queued' : `${pendingCount} actions queued`;
  const message = isOffline
    ? `Offline mode. ${queuedLabel} will sync when internet returns.`
    : `${queuedLabel} syncing now.`;

  return (
    <View
      accessibilityRole="alert"
      style={[
        {
          backgroundColor: isOffline ? `${colors.gold}33` : `${colors.brand}18`,
          borderColor: isOffline ? colors.gold : colors.brand,
          borderRadius: radii.md,
          borderWidth: 1,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        style,
      ]}
    >
      <Text
        style={{
          // The banner bg is a light gold/green tint in BOTH themes, so use the
          // non-swapping dark ink — colors.ink turns light in dark mode → invisible.
          color: isOffline ? colors.inverse : colors.brand,
          fontFamily: fonts.bodySemiBold,
          fontSize: 13,
        }}
      >
        {message}
      </Text>
    </View>
  );
}
