import type React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card } from '@/components/ui/Card';
import { Heading, Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

interface AuthScreenProps {
  title: string;
  subtitle: string;
  eyebrow?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  contentStyle?: ViewStyle;
}

export function AuthScreen({
  title,
  subtitle,
  eyebrow,
  children,
  footer,
  contentStyle,
}: AuthScreenProps) {
  const { colors, fonts, spacing } = useTheme();

  return (
    <SafeAreaView style={{ backgroundColor: colors.bg, flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            padding: spacing.lg,
          }}
          keyboardShouldPersistTaps="handled"
          style={{ backgroundColor: colors.bg }}
        >
          <View
            style={[
              {
                alignSelf: 'center',
                gap: spacing.lg,
                maxWidth: 520,
                width: '100%',
              },
              contentStyle,
            ]}
          >
            <View style={{ gap: spacing.sm }}>
              {eyebrow ? (
                <Text
                  style={{
                    color: colors.brand,
                    fontFamily: fonts.bodySemiBold,
                    textTransform: 'uppercase',
                  }}
                >
                  {eyebrow}
                </Text>
              ) : null}
              <Heading>{title}</Heading>
              <Text style={{ color: colors.muted, lineHeight: 22 }}>{subtitle}</Text>
            </View>
            <Card style={{ gap: spacing.md }}>{children}</Card>
            {footer ? <View>{footer}</View> : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
