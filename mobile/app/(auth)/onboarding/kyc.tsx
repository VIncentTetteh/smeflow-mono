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

  // Phase: 'personal' collects Ghana Card; 'business' collects Business Reg + TIN.
  // Users who are already verified skip straight to 'business'.
  const [phase, setPhase] = useState<'personal' | 'business'>(
    userAlreadyVerified ? 'business' : 'personal',
  );

  const [ghanaCardId, setGhanaCardId] = useState('');
  const [businessRegRef, setBusinessRegRef] = useState('');
  const [tin, setTin] = useState('');
  const [loading, setLoading] = useState(false);

  type KycErrors = { ghanaCard?: string; businessReg?: string; tin?: string; general?: string };
  const [errors, setErrors] = useState<KycErrors>({});

  async function submitPersonal() {
    if (loading) return;
    if (!validGhanaCard(ghanaCardId)) {
      setErrors({ ghanaCard: 'Enter Ghana Card in the format GHA-123456789-0.' });
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      await submitUserKyc({ ghana_card_id: ghanaCardId });
      setPhase('business');
    } catch (err) {
      setErrors({ general: toApiErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  async function submitBusiness() {
    if (loading) return;
    const next: KycErrors = {};
    if (!businessRegRef.trim()) {
      next.businessReg = 'Business registration number is required.';
    }
    if (tin.trim() && !validTin(tin)) {
      next.tin = 'TIN must be exactly 11 digits.';
    }
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      await submitBusinessKyc({
        business_registration_ref: businessRegRef.trim(),
        tin: tin.trim() || undefined,
        documents: [],
      });
      trackEvent(MOBILE_ANALYTICS_EVENTS.KYC_SUBMITTED, { scope: 'onboarding' });
      router.push('/onboarding/plan');
    } catch (err) {
      setErrors({ general: toApiErrorMessage(err) });
    } finally {
      setLoading(false);
    }
  }

  if (phase === 'personal') {
    return (
      <WizardScreen
        continueLabel="Next · Business details"
        continueLoading={loading}
        onBack={() => router.back()}
        onContinue={submitPersonal}
        step={4}
        stepLabel="Identity"
        title="Verify your identity"
        totalSteps={5}
      >
        <View style={{ gap: 4 }}>
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
          <Text style={{ color: colors.muted, fontSize: 12 }}>
            Format: GHA-XXXXXXXXX-X
          </Text>
        </View>

        <View style={{ gap: spacing.sm }}>
          {errors.general ? <StatusMessage message={errors.general} tone="error" /> : null}
        </View>
      </WizardScreen>
    );
  }

  return (
    <WizardScreen
      continueLabel="Continue · Plan"
      continueLoading={loading}
      onBack={() => userAlreadyVerified ? router.back() : setPhase('personal')}
      onContinue={submitBusiness}
      step={4}
      stepLabel="Business"
      title="Verify your business"
      totalSteps={5}
    >
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
