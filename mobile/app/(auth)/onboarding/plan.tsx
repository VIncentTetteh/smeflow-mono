import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { WizardScreen } from '@/components/layout/WizardScreen';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { toApiErrorMessage } from '@/api/errors';
import { useSelectPlan } from '@/api/hooks/featureHooks';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { useTheme } from '@/lib/theme';

const PLANS = [
  {
    tier: 'free',
    label: 'Free',
    price: 'GH₵ 0/mo',
    features: ['50 inventory items', '50 customer records', '30 AI messages/month', 'English chat'],
  },
  {
    tier: 'starter',
    label: 'Starter',
    price: 'GH₵ 49/mo',
    features: ['500 inventory items', '500 customers', '20 invoices/month', '3 employees', 'Credit access'],
  },
  {
    tier: 'pro',
    label: 'Pro',
    price: 'GH₵ 149/mo',
    features: ['Unlimited core limits', '1 owner + 5 staff', 'Unlimited field agents', '3 businesses', 'GRA submission'],
  },
] as const;

export default function PlanSelectionScreen() {
  const { colors, fonts, spacing, radii } = useTheme();
  const router = useRouter();
  const [selected, setSelected] = useState<string>('free');
  const [error, setError] = useState<string | null>(null);
  const selectPlan = useSelectPlan();

  function onContinue() {
    setError(null);
    if (selected === 'free') {
      trackEvent(MOBILE_ANALYTICS_EVENTS.ONBOARDING_COMPLETED, { tier: selected });
      router.replace('/owner');
    } else {
      selectPlan.mutate(
        { tier: selected },
        {
          onSuccess: () => {
            trackEvent(MOBILE_ANALYTICS_EVENTS.ONBOARDING_COMPLETED, { tier: selected });
            router.replace('/owner');
          },
          onError: (selectError) => setError(toApiErrorMessage(selectError)),
        }
      );
    }
  }

  return (
    <WizardScreen
      continueLabel="Start using SMEflow"
      continueLoading={selectPlan.isPending}
      onBack={() => router.back()}
      onContinue={onContinue}
      step={5}
      stepLabel="Plan"
      title="Choose your plan"
      totalSteps={5}
    >
      <Text style={{ fontSize: 13.5, color: colors.muted, lineHeight: 20, marginBottom: spacing.sm }}>
        Start free and upgrade anytime as your business grows.
      </Text>

      {error ? <StatusMessage message={error} tone="error" /> : null}

      <View style={{ gap: spacing.sm }}>
        {PLANS.map((plan) => {
          const isSelected = selected === plan.tier;
          return (
            <TouchableOpacity
              key={plan.tier}
              activeOpacity={0.8}
              onPress={() => setSelected(plan.tier)}
              style={{
                borderRadius: radii.md,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? colors.brand : colors.border,
                padding: spacing.md,
                backgroundColor: isSelected ? `${colors.brand}08` : colors.surface,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>
                  {plan.label}
                </Text>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.brand }}>
                  {plan.price}
                </Text>
              </View>
              <View style={{ gap: 4 }}>
                {plan.features.map((f) => (
                  <Text key={f} style={{ color: colors.muted, fontSize: 13 }}>
                    {'✓ '}{f}
                  </Text>
                ))}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </WizardScreen>
  );
}
