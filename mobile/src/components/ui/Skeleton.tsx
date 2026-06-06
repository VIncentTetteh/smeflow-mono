import { useEffect, useRef } from 'react';
import { Animated, View, type ViewStyle } from 'react-native';
import { useTheme } from '@/lib/theme';

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  style?: ViewStyle;
  testID?: string;
}

export function Skeleton({
  width = '100%',
  height = 16,
  borderRadius = 6,
  style,
  testID,
}: SkeletonProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return (
    <Animated.View
      testID={testID}
      style={[
        { width, height, borderRadius, backgroundColor: colors.border },
        { opacity },
        style,
      ]}
    />
  );
}

export function CardSkeleton() {
  const { spacing } = useTheme();
  return (
    <View
      style={{
        backgroundColor: '#fff',
        borderRadius: 10,
        gap: spacing.sm,
        padding: spacing.md,
      }}
    >
      <Skeleton height={14} width="60%" />
      <Skeleton height={24} width="40%" />
      <Skeleton height={14} width="80%" />
      <Skeleton height={14} width="50%" />
    </View>
  );
}
