import { useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { submitBusinessKyc } from '@/api/business.api';
import { toApiErrorMessage } from '@/api/errors';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { Button } from '@/components/ui/Button';
import { useTheme } from '@/lib/theme';

function validTin(value: string): boolean {
  const trimmed = value.trim();
  return trimmed === '' || /^\d{11}$/.test(trimmed);
}

export default function KycBusinessScreen() {
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();

  const [businessRegRef, setBusinessRegRef] = useState('');
  const [tin, setTin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regError, setRegError] = useState<string | undefined>();
  const [tinError, setTinError] = useState<string | undefined>();

  async function submit() {
    if (loading) return;
    let hasError = false;
    if (!businessRegRef.trim()) {
      setRegError('Business registration number is required.');
      hasError = true;
    }
    if (tin.trim() && !validTin(tin)) {
      setTinError('TIN must be exactly 11 digits.');
      hasError = true;
    }
    if (hasError) return;

    setLoading(true);
    setError(null);
    try {
      await submitBusinessKyc({
        business_registration_ref: businessRegRef.trim(),
        tin: tin.trim() || undefined,
        documents: [],
      });
      router.back();
    } catch (err) {
      setError(toApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center', gap: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>
            Business verification
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
            Submit your business registration details
          </Text>
        </View>
      </View>

      <View style={{ flex: 1, padding: 16, gap: spacing.md }}>
        <StyledTextInput
          autoCapitalize="characters"
          error={regError}
          label="Business registration number"
          onChangeText={(value) => {
            setBusinessRegRef(value);
            setRegError(undefined);
            setError(null);
          }}
          placeholder="BN-12345678"
          value={businessRegRef}
        />

        <StyledTextInput
          autoCapitalize="characters"
          error={tinError}
          label="TIN (optional)"
          keyboardType="numeric"
          onChangeText={(value) => {
            setTin(value);
            setTinError(undefined);
            setError(null);
          }}
          placeholder="12345678901"
          value={tin}
        />

        {error ? <StatusMessage message={error} tone="error" /> : null}

        <Button
          label="Start business verification"
          loading={loading}
          onPress={submit}
          variant="primary"
        />
      </View>
    </SafeAreaView>
  );
}
