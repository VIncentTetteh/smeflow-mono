import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { requestOtp } from '@/api/auth.api';
import { toApiErrorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { isBiometricAvailable, biometricUnlock } from '@/lib/deviceFeatures';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

function normalizeGhanaPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('233') ? digits.slice(3) : digits.replace(/^0/, '');
  if (local.length !== 9) return null;
  return `+233${local}`;
}

export default function PhoneScreen() {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();
  const setPendingOtpPhone = useAuthStore((state) => state.setPendingOtpPhone);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const normalizedPhone = useMemo(() => normalizeGhanaPhone(phone), [phone]);

  useEffect(() => {
    if (biometricEnabled) {
      isBiometricAvailable().then(setBiometricAvailable);
    }
  }, [biometricEnabled]);

  async function submit() {
    if (loading) return;
    if (!normalizedPhone) {
      setError('Enter a valid Ghana phone number, for example 024 000 0000.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await requestOtp({ phone: normalizedPhone });
      setPendingOtpPhone(normalizedPhone);
      router.push({ pathname: '/otp', params: { phone: normalizedPhone } });
    } catch (requestError) {
      setError(toApiErrorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand mark */}
          <View style={{ marginTop: spacing.sm }}>
            <View style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              backgroundColor: colors.ink,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Text style={{
                fontFamily: fonts.displaySemiBold,
                fontSize: 18,
                color: '#fdf7eb',
              }}>
                S
              </Text>
            </View>
          </View>

          {/* Headline */}
          <Text style={{
            marginTop: spacing.lg,
            fontSize: 30,
            fontFamily: fonts.displaySemiBold,
            color: colors.ink,
            lineHeight: 34,
            letterSpacing: -0.75,
          }}>
            Run your business{'\n'}from your phone.
          </Text>
          <Text style={{
            marginTop: 10,
            fontSize: 14,
            color: colors.muted,
            lineHeight: 21,
          }}>
            Sales, MoMo, stock, receipts, tax — all in one. Free for solo traders.
          </Text>

          {/* Push bottom content down */}
          <View style={{ flex: 1, minHeight: 40 }} />

          {/* Phone label */}
          <Text style={{
            fontSize: 11.5,
            color: colors.muted,
            fontFamily: fonts.bodySemiBold,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 6,
          }}>
            Phone number
          </Text>

          {/* Phone input row */}
          <View style={{
            flexDirection: 'row',
            alignItems: 'center',
            height: 52,
            paddingHorizontal: 14,
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: colors.border,
            borderRadius: 14,
          }}>
            <Text style={{
              fontSize: 14,
              color: colors.ink,
              fontFamily: fonts.bodySemiBold,
            }}>
              🇬🇭 +233
            </Text>
            <View style={{ width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 8 }} />
            <TextInput
              keyboardType="phone-pad"
              onChangeText={(v) => { setPhone(v); setError(null); }}
              placeholder="024 000 0000"
              placeholderTextColor={colors.muted}
              style={{
                flex: 1,
                fontSize: 17,
                fontFamily: fonts.body,
                color: colors.ink,
                letterSpacing: 0.3,
              }}
              value={phone}
            />
          </View>

          <Text style={{ marginTop: 8, fontSize: 11.5, color: colors.muted }}>
            We'll send a one-time code via SMS. MTN, Telecel, AirtelTigo supported.
          </Text>

          {error ? (
            <View style={{ marginTop: 8 }}>
              <StatusMessage message={error} tone="error" />
            </View>
          ) : null}

          <View style={{ height: spacing.md }} />

          <Button
            disabled={!normalizedPhone}
            label="Send code"
            loading={loading}
            onPress={submit}
          />

          {biometricAvailable && biometricEnabled && isAuthenticated() ? (
            <Button
              label="Sign in with biometrics"
              onPress={async () => {
                const ok = await biometricUnlock();
                if (ok) {
                  router.replace('/owner');
                } else {
                  setError('Biometric sign-in failed. Use your phone number instead.');
                }
              }}
              style={{ marginTop: spacing.sm }}
              variant="soft"
            />
          ) : null}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
