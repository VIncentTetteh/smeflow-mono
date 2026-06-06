import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text as RNText } from 'react-native';
import { useTheme } from '@/lib/theme';

export type ToastTone = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  tone: ToastTone;
  visible: boolean;
  onHide: () => void;
}

export function Toast({ message, tone, visible, onHide }: ToastProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0)).current;

  const bgColor: Record<ToastTone, string> = {
    success: colors.brand,
    error: colors.danger,
    info: colors.info,
  };

  useEffect(() => {
    if (visible) {
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.delay(2800),
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start(() => onHide());
    }
  }, [visible, opacity, onHide]);

  if (!visible) return null;

  return (
    <Animated.View style={[styles.container, { opacity, backgroundColor: bgColor[tone] }]}>
      {/* Use RNText directly so color: '#fff' is not overridden by the themed Text component */}
      <RNText style={styles.text}>{message}</RNText>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    borderRadius: 10,
    padding: 14,
    zIndex: 9999,
    elevation: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  text: { color: '#fff', fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
