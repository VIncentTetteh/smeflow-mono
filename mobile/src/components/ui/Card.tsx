import { View, type ViewProps, type ViewStyle } from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

interface CardProps extends ViewProps {
  style?: ViewStyle;
}

export function Card({ children, style, ...props }: CardProps) {
  const { colors, radii, spacing } = useTheme();
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: radii.md,
          padding: spacing.md,
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowRadius: 4,
          shadowOffset: { width: 0, height: 2 },
          elevation: 1,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.border }} />;
}

const AVATAR_COLORS = ['#1f6a4f', '#5b6be5', '#d03514', '#e8c25a', '#8b4513'];

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const { fonts } = useTheme();
  const safeName = name || 'U';
  const initials = safeName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  const color = AVATAR_COLORS[safeName.charCodeAt(0) % AVATAR_COLORS.length];

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: '#fff',
          fontSize: size * 0.38,
          fontFamily: fonts.bodySemiBold,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}
