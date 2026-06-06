import {
  Modal as NativeModal,
  Pressable,
  View,
  type ModalProps as NativeModalProps,
  type ViewStyle,
} from 'react-native';
import type React from 'react';
import { Button } from './Button';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

interface ModalProps extends Pick<NativeModalProps, 'animationType'> {
  visible: boolean;
  title?: string;
  message?: string;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onClose: () => void;
  style?: ViewStyle;
}

export function Modal({
  visible,
  title,
  message,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onClose,
  animationType = 'fade',
  style,
}: ModalProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  return (
    <NativeModal
      animationType={animationType}
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <View
        style={{
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.36)',
          flex: 1,
          justifyContent: 'center',
          padding: spacing.lg,
        }}
      >
        <View
          style={[
            {
              backgroundColor: colors.surface,
              borderRadius: radii.lg,
              gap: spacing.md,
              maxWidth: 420,
              padding: spacing.lg,
              width: '100%',
            },
            style,
          ]}
        >
          {title ? (
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22 }}>{title}</Text>
          ) : null}
          {message ? <Text style={{ color: colors.muted, fontSize: 14 }}>{message}</Text> : null}
          {children}
          {(confirmLabel || cancelLabel) ? (
            <View style={{ flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' }}>
              <Button label={cancelLabel} onPress={onClose} variant="ghost" style={{ flex: 1 }} />
              {confirmLabel ? (
                <Button
                  label={confirmLabel}
                  onPress={onConfirm ?? onClose}
                  style={{ flex: 1 }}
                />
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
    </NativeModal>
  );
}

interface BottomSheetProps {
  visible: boolean;
  title?: string;
  children: React.ReactNode;
  onClose: () => void;
  style?: ViewStyle;
}

export function BottomSheet({ visible, title, children, onClose, style }: BottomSheetProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  return (
    <NativeModal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View
        style={{
          backgroundColor: 'rgba(0,0,0,0.28)',
          flex: 1,
          justifyContent: 'flex-end',
        }}
      >
        <Pressable accessibilityLabel="Close bottom sheet" onPress={onClose} style={{ flex: 1 }} />
        <View
          style={[
            {
              backgroundColor: colors.surface,
              borderTopLeftRadius: radii.lg,
              borderTopRightRadius: radii.lg,
              gap: spacing.md,
              padding: spacing.lg,
            },
            style,
          ]}
        >
          <View
            style={{
              alignSelf: 'center',
              backgroundColor: colors.border,
              borderRadius: radii.full,
              height: 4,
              width: 44,
            }}
          />
          {title ? (
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22 }}>{title}</Text>
          ) : null}
          {children}
        </View>
      </View>
    </NativeModal>
  );
}

interface SnackBarProps {
  visible: boolean;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'info' | 'success' | 'danger';
  style?: ViewStyle;
}

export function SnackBar({
  visible,
  message,
  actionLabel,
  onAction,
  variant = 'info',
  style,
}: SnackBarProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  if (!visible) {
    return null;
  }

  const bgMap = {
    info: colors.ink,
    success: colors.brand,
    danger: colors.danger,
  };

  return (
    <View
      accessibilityRole="alert"
      style={[
        {
          alignItems: 'center',
          backgroundColor: bgMap[variant],
          borderRadius: radii.md,
          flexDirection: 'row',
          gap: spacing.md,
          justifyContent: 'space-between',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 2,
        },
        style,
      ]}
    >
      <Text style={{ color: '#fff', flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
        {message}
      </Text>
      {actionLabel ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <Text style={{ color: colors.gold, fontFamily: fonts.bodySemiBold, fontSize: 13 }}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export const Toast = SnackBar;
