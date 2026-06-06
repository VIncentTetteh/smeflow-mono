import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { addMomoAccount } from '@/api/business.api';
import { toApiErrorMessage } from '@/api/errors';
import { WizardScreen } from '@/components/layout/WizardScreen';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import type { MomoProvider } from '@/types/business';

const PROVIDERS: Array<{ id: MomoProvider; label: string }> = [
  { id: 'mtn', label: 'MTN MoMo' },
  { id: 'vodafone', label: 'Telecel Cash' },
  { id: 'airteltigo', label: 'AT Money' },
];

function normalizeGhanaPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('233') ? digits.slice(3) : digits.replace(/^0/, '');
  return local.length === 9 ? `+233${local}` : null;
}

export default function MomoScreen() {
  const [provider, setProvider] = useState<MomoProvider>('mtn');
  const [phone, setPhone] = useState('');
  const [accountName, setAccountName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();

  async function linkAndContinue() {
    if (loading) return;
    const normalizedPhone = normalizeGhanaPhone(phone);

    if (!phone.trim()) {
      router.push('/onboarding/kyc');
      return;
    }
    if (!normalizedPhone) {
      setError('Enter a valid Ghana phone number for this wallet.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await addMomoAccount({
        provider,
        phone: normalizedPhone,
        account_name: accountName.trim() || undefined,
        is_primary: true,
      });
      router.push('/onboarding/kyc');
    } catch (submitError) {
      setError(toApiErrorMessage(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <WizardScreen
      continueLabel="Continue · Identity"
      continueLoading={loading}
      onBack={() => router.back()}
      onContinue={linkAndContinue}
      step={3}
      stepLabel="Wallets"
      title="Link a Mobile Money wallet"
      totalSteps={5}
    >
      {/* Provider chips */}
      <View style={{ gap: spacing.xs }}>
        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Provider
        </Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          {PROVIDERS.map((item) => {
            const selected = provider === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                onPress={() => setProvider(item.id)}
                style={{
                  paddingVertical: 7,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                {selected ? (
                  <Text style={{ fontSize: 11, color: '#fdf7eb', fontFamily: fonts.bodySemiBold }}>✓</Text>
                ) : null}
                <Text style={{
                  fontSize: 12,
                  fontFamily: fonts.bodySemiBold,
                  color: selected ? '#fdf7eb' : colors.muted,
                }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <StyledTextInput
        keyboardType="phone-pad"
        label="Wallet phone number"
        onChangeText={(value) => { setPhone(value); setError(null); }}
        placeholder="024 000 0000"
        value={phone}
      />
      <StyledTextInput
        label="Account name"
        onChangeText={setAccountName}
        placeholder="Optional"
        value={accountName}
      />

      <Text style={{ fontSize: 12.5, color: colors.muted, lineHeight: 18 }}>
        Add a settlement wallet so sales and payment requests can connect to real money movement. You can skip this step and add one later.
      </Text>

      {error ? <StatusMessage message={error} tone="error" /> : null}
    </WizardScreen>
  );
}
