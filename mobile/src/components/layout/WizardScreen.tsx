import type React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

interface WizardScreenProps {
  step: number;
  totalSteps: number;
  stepLabel: string;
  title: string;
  children: React.ReactNode;
  onBack?: () => void;
  onContinue: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  continueLoading?: boolean;
  contentStyle?: ViewStyle;
}

export function WizardScreen({
  step,
  totalSteps,
  stepLabel,
  title,
  children,
  onBack,
  onContinue,
  continueLabel = 'Continue',
  continueDisabled,
  continueLoading,
  contentStyle,
}: WizardScreenProps) {
  const { colors, fonts, spacing, radii } = useTheme();

  return (
    <SafeAreaView style={{ backgroundColor: colors.bg, flex: 1 }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Wizard header */}
        <View style={{ paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: 4, marginBottom: 10 }}>
            {Array.from({ length: totalSteps }).map((_, i) => (
              <View
                key={i}
                style={{
                  flex: 1,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: i < step ? colors.brand : colors.border,
                }}
              />
            ))}
          </View>
          <Text
            style={{
              fontSize: 11,
              color: colors.muted,
              fontFamily: fonts.bodySemiBold,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
            }}
          >
            Step {step} of {totalSteps} · {stepLabel}
          </Text>
          <Text
            style={{
              marginTop: 4,
              fontSize: 24,
              fontFamily: fonts.displaySemiBold,
              color: colors.ink,
              letterSpacing: -0.5,
            }}
          >
            {title}
          </Text>
        </View>

        {/* Scrollable body */}
        <ScrollView
          contentContainerStyle={[
            { paddingHorizontal: spacing.md, paddingBottom: spacing.md, paddingTop: spacing.sm },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1 }}
        >
          {children}
        </ScrollView>

        {/* Sticky footer */}
        <View
          style={{
            paddingHorizontal: spacing.md,
            paddingTop: spacing.sm + 2,
            paddingBottom: spacing.lg,
            backgroundColor: colors.surface,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            flexDirection: 'row',
            gap: spacing.sm,
          }}
        >
          {onBack ? (
            <TouchableOpacity
              disabled={continueLoading}
              onPress={onBack}
              style={{
                height: 50,
                paddingHorizontal: spacing.md,
                borderRadius: radii.md,
                borderWidth: 1,
                borderColor: colors.border,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: continueLoading ? 0.4 : 1,
              }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.muted, fontSize: 15 }}>
                Back
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={continueDisabled || continueLoading}
            onPress={onContinue}
            style={{
              flex: 1,
              height: 50,
              borderRadius: radii.md,
              backgroundColor: continueDisabled ? colors.border : colors.brand,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
            }}
          >
            {continueLoading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={{ fontFamily: fonts.bodySemiBold, color: '#fff', fontSize: 15 }}>
                  {continueLabel}
                </Text>
                <Text style={{ color: '#fff', fontSize: 15 }}>→</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
