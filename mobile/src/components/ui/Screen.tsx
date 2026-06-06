import type React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ViewStyle,
} from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { Heading, Text } from './Text';
import { useTheme } from '@/lib/theme';

interface ScreenProps {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
}

export function Screen({ children, scroll = true, style }: ScreenProps) {
  const { colors, spacing } = useTheme();
  const contentStyle = [
    {
      alignSelf: 'center' as const,
      flexGrow: 1,
      gap: spacing.md,
      maxWidth: 720,
      padding: spacing.md,
      width: '100%' as const,
    },
    style,
  ];

  if (!scroll) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ backgroundColor: colors.bg, flex: 1 }}
      >
        <View style={[{ flex: 1 }, ...contentStyle]}>{children}</View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ backgroundColor: colors.bg, flex: 1 }}
    >
      <ScrollView
        contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: colors.bg, flex: 1 }}
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function SectionHeader({ title, subtitle, actionLabel, onAction }: SectionHeaderProps) {
  const { colors, fonts, spacing } = useTheme();

  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 16 }}>{title}</Text>
        {subtitle ? <Text style={{ color: colors.muted, marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="soft" style={{ paddingVertical: 8 }} />
      ) : null}
    </View>
  );
}

interface EmptyStateProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ title, message, actionLabel, onAction }: EmptyStateProps) {
  const { colors, spacing } = useTheme();

  return (
    <Card style={{ alignItems: 'flex-start', gap: spacing.sm }}>
      <Heading style={{ fontSize: 22 }}>{title}</Heading>
      <Text style={{ color: colors.muted }}>{message}</Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </Card>
  );
}

export function LoadingState({ title = 'Loading', message = 'Fetching the latest data.' }) {
  const { colors, spacing } = useTheme();

  return (
    <Card style={{ gap: spacing.sm }}>
      <Heading style={{ fontSize: 22 }}>{title}</Heading>
      <Text style={{ color: colors.muted }}>{message}</Text>
      <View style={{ gap: spacing.sm }}>
        {[0, 1, 2].map((item) => (
          <View
            key={item}
            style={{
              backgroundColor: colors.border,
              borderRadius: 8,
              height: item === 0 ? 18 : 14,
              opacity: 0.7 - item * 0.15,
              width: item === 0 ? '72%' : item === 1 ? '92%' : '58%',
            }}
          />
        ))}
      </View>
    </Card>
  );
}

interface ErrorStateProps {
  title?: string;
  message: string;
  actionLabel?: string;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something needs attention',
  message,
  actionLabel = 'Try again',
  onRetry,
}: ErrorStateProps) {
  const { colors, spacing } = useTheme();

  return (
    <Card style={{ borderColor: `${colors.danger}66`, gap: spacing.sm }}>
      <Heading style={{ color: colors.danger, fontSize: 22 }}>{title}</Heading>
      <Text style={{ color: colors.muted }}>{message}</Text>
      {onRetry ? <Button label={actionLabel} onPress={onRetry} variant="soft" /> : null}
    </Card>
  );
}
