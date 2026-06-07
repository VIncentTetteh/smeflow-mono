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
import { useAuthStore } from '@/store/auth';

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
  const router = useRouter();
  const { colors, spacing } = useTheme();
  const userKycStatus = useAuthStore((s) => s.userKycStatus);
  const userAlreadyVerified = userKycStatus?.kyc_status === 'verified';

  const [ghanaCardId, setGhanaCardId] = useState('');
  const [businessRegRef, setBusinessRegRef] = useState('');
  const [tin, setTin] = useState('');
  const [loading, setLoading] = useState(false);

  type KycErrors = { ghanaCard?: string; businessReg?: string; tin?: string; general?: string };
  const [errors, setErrors] = useState<KycErrors>({});

  function validate(): boolean {
    const next: KycErrors = {};

    if (!userAlreadyVerified && !validGhanaCard(ghanaCardId)) {
      next.ghanaCard = 'Enter Ghana Card in the format GHA-123456789-0.';
    }
    if (!businessRegRef.trim()) {
      next.businessReg = 'Business registration number is required.';
    }
    if (tin.trim() && !validTin(tin)) {
      next.tin = 'TIN must be exactly 11 digits.';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function submit() {
    if (loading) return;
    if (!validate()) return;
    setLoading(true);
    setErrors({});

    try {
      if (!userAlreadyVerified) {
        await submitUserKyc({ ghana_card_id: ghanaCardId });
      }
      await submitBusinessKyc({
        business_registration_ref: businessRegRef.trim(),
        tin: tin.trim() || undefined,
        documents: [],
      });
      trackEvent(MOBILE_ANALYTICS_EVENTS.KYC_SUBMITTED, { scope: 'onboarding' });
      router.push('/onboarding/plan');
    } catch (err) {
      setErrors((prev) => ({ ...prev, general: toApiErrorMessage(err) }));
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
      {!userAlreadyVerified ? (
        <>
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
        </>
      ) : null}

      <StyledTextInput
        autoCapitalize="characters"
        error={errors.businessReg}
        label="Business registration number"
        onChangeText={(value) => {
          setBusinessRegRef(value);
          setErrors((prev) => ({ ...prev, businessReg: undefined }));
        }}
        placeholder="BN-12345678"
        value={businessRegRef}
      />

      <StyledTextInput
        autoCapitalize="characters"
        error={errors.tin}
        label="TIN (optional)"
        onChangeText={(value) => {
          setTin(value);
          setErrors((prev) => ({ ...prev, tin: undefined }));
        }}
        placeholder="12345678901"
        value={tin}
      />

      <View style={{ gap: spacing.sm }}>
        {errors.general ? <StatusMessage message={errors.general} tone="error" /> : null}
      </View>
    </WizardScreen>
  );
}
