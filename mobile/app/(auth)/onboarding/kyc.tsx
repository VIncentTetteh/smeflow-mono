import { useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { submitUserKyc } from '@/api/auth.api';
import { submitBusinessKyc } from '@/api/business.api';
import { toApiErrorMessage } from '@/api/errors';
import { WizardScreen } from '@/components/layout/WizardScreen';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { useTheme } from '@/lib/theme';

function formatGhanaCard(value: string): string {
  const stripped = value.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (stripped.length <= 3) return stripped;
  if (stripped.length <= 12) return `${stripped.slice(0, 3)}-${stripped.slice(3)}`;
  return `${stripped.slice(0, 3)}-${stripped.slice(3, 12)}-${stripped.slice(12, 13)}`;
}

function validGhanaCard(value: string): boolean {
  return /^GHA-\d{9}-\d$/.test(value);
}

function validTin(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^\d{11}$/.test(trimmed);
}

export default function KYCScreen() {
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [tin, setTin] = useState('');
  const [businessRegistrationRef, setBusinessRegistrationRef] = useState('');
  const [loading, setLoading] = useState(false);
  type KycErrors = { ghanaCard?: string; tin?: string; general?: string };
  const [errors, setErrors] = useState<KycErrors>({});
  const router = useRouter();
  const { colors, spacing } = useTheme();

  function finish() {
    router.push('/onboarding/plan');
  }

  function validate(): boolean {
    const newErrors: KycErrors = {};
    if (!validGhanaCard(ghanaCardId)) {
      newErrors.ghanaCard = 'Enter Ghana Card in the format GHA-123456789-0.';
    }
    if (tin.trim() && !validTin(tin)) {
      newErrors.tin = 'TIN must be exactly 11 digits.';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function submit() {
    if (loading) return;
    if (!validate()) return;
    setLoading(true);
    setErrors({});
    try {
      try {
        await submitUserKyc({
          ghana_card_id: ghanaCardId,
          tin: tin.trim() || undefined,
        });
      } catch (userKycError: unknown) {
        const status = (userKycError as { status?: number }).status;
        if (status !== 409) throw userKycError;
      }
      await submitBusinessKyc({
        ghana_card_id: ghanaCardId,
        tin: tin.trim() || undefined,
        business_registration_ref: businessRegistrationRef.trim() || undefined,
        documents: [],
      });
      trackEvent(MOBILE_ANALYTICS_EVENTS.KYC_SUBMITTED, { scope: 'onboarding' });
      finish();
    } catch (submitError) {
      setErrors((prev) => ({ ...prev, general: toApiErrorMessage(submitError) }));
    } finally {
      setLoading(false);
    }
  }

  return (
    <WizardScreen
      continueLabel="Continue · Plan"
      continueLoading={loading}
      onBack={() => router.back()}
      onContinue={submit}
      step={4}
      stepLabel="Identity"
      title="Verify identity and business"
      totalSteps={5}
    >
      <StyledTextInput
        autoCapitalize="characters"
        error={errors.ghanaCard}
        label="Ghana Card number"
        maxLength={15}
        onChangeText={(value) => {
          setGhanaCardId(formatGhanaCard(value));
          setErrors((prev) => ({ ...prev, ghanaCard: undefined }));
        }}
        placeholder="GHA-123456789-0"
        value={ghanaCardId}
      />
      <Text style={{ color: colors.muted, fontSize: 12, marginTop: -spacing.sm }}>
        Format: GHA-XXXXXXXXX-X
      </Text>

      <StyledTextInput
        autoCapitalize="characters"
        error={errors.tin}
        label="TIN"
        onChangeText={(value) => {
          setTin(value);
          setErrors((prev) => ({ ...prev, tin: undefined }));
        }}
        placeholder="Optional"
        value={tin}
      />
      <StyledTextInput
        autoCapitalize="characters"
        label="Business registration reference"
        onChangeText={setBusinessRegistrationRef}
        placeholder="Optional"
        value={businessRegistrationRef}
      />

      <View style={{ gap: spacing.sm }}>
        {errors.general ? <StatusMessage message={errors.general} tone="error" /> : null}
      </View>
    </WizardScreen>
  );
}
