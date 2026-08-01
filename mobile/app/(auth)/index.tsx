import { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { requestEmailLogin, requestOtp } from '@/api/auth.api';
import { normalizeApiError, toApiErrorMessage } from '@/api/errors';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { resetScopedLocalData } from '@/db/scopedData';
import { isBiometricAvailable, biometricUnlock } from '@/lib/deviceFeatures';
import { getHomeRouteForRole } from '@/navigation/authRouting';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { useQueryClient } from '@tanstack/react-query';

type Method = 'phone' | 'email';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeGhanaPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('233') ? digits.slice(3) : digits.replace(/^0/, '');
  if (local.length !== 9) return null;
  return `+233${local}`;
}

export default function LoginScreen() {
  const [method, setMethod] = useState<Method>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const setPendingOtpPhone = useAuthStore((state) => state.setPendingOtpPhone);
  const setPendingEmailLogin = useAuthStore((state) => state.setPendingEmailLogin);
  const setAuth = useAuthStore((state) => state.setAuth);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const normalizedPhone = useMemo(() => normalizeGhanaPhone(phone), [phone]);
  const normalizedEmail = email.trim().toLowerCase();
  const emailValid = EMAIL_PATTERN.test(normalizedEmail);
  const canSubmit = method === 'phone' ? !!normalizedPhone : emailValid;

  useEffect(() => {
    if (biometricEnabled) {
      isBiometricAvailable().then(setBiometricAvailable);
    }
  }, [biometricEnabled]);

  function switchMethod(next: Method) {
    setMethod(next);
    setError(null);
  }

  async function submit() {
    if (loading || !canSubmit) return;
    setLoading(true);
    setError(null);
    try {
      if (method === 'phone') {
        await requestOtp({ phone: normalizedPhone! });
        setPendingOtpPhone(normalizedPhone!);
        router.push({ pathname: '/otp', params: { phone: normalizedPhone! } });
      } else {
        await requestEmailLogin({ email: normalizedEmail });
        setPendingEmailLogin(normalizedEmail);
        router.push({ pathname: '/email-otp', params: { email: normalizedEmail } });
      }
    } catch (requestError) {
      setError(
        method === 'phone'
          ? toApiErrorMessage(requestError)
          : normalizeApiError(requestError).message
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, padding: spacing.lg }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Brand mark */}
          <View style={{ marginTop: spacing.sm }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                backgroundColor: colors.inverse,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: '#fdf7eb' }}>
                S
              </Text>
            </View>
          </View>

          {/* Headline */}
          <Text
            style={{
              marginTop: spacing.lg,
              fontSize: 30,
              fontFamily: fonts.displaySemiBold,
              color: colors.ink,
              lineHeight: 34,
              letterSpacing: -0.75,
            }}
          >
            Run your business{'\n'}from your phone.
          </Text>
          <Text style={{ marginTop: 10, fontSize: 14, color: colors.muted, lineHeight: 21 }}>
            Sales, MoMo, stock, receipts, tax — all in one. Free for solo traders.
          </Text>

          {/* Push bottom content down */}
          <View style={{ flex: 1, minHeight: 40 }} />

          {/* Phone / Email tab switcher */}
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: colors.surface,
              borderWidth: 1.5,
              borderColor: colors.border,
              borderRadius: 14,
              padding: 4,
              marginBottom: spacing.md,
            }}
          >
            {(['phone', 'email'] as Method[]).map((m) => {
              const active = method === m;
              return (
                <TouchableOpacity
                  key={m}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  activeOpacity={0.8}
                  onPress={() => switchMethod(m)}
                  style={{
                    flex: 1,
                    height: 40,
                    borderRadius: 10,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: active ? colors.brand : 'transparent',
                  }}
                >
                  <Text
                    style={{
                      fontSize: 14,
                      fontFamily: fonts.bodySemiBold,
                      color: active ? '#fff' : colors.muted,
                    }}
                  >
                    {m === 'phone' ? 'Phone' : 'Email'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Field label */}
          <Text
            style={{
              fontSize: 11.5,
              color: colors.muted,
              fontFamily: fonts.bodySemiBold,
              textTransform: 'uppercase',
              letterSpacing: 0.8,
              marginBottom: 6,
            }}
          >
            {method === 'phone' ? 'Phone number' : 'Email address'}
          </Text>

          {method === 'phone' ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                height: 52,
                paddingHorizontal: 14,
                backgroundColor: colors.surface,
                borderWidth: 1.5,
                borderColor: colors.border,
                borderRadius: 14,
              }}
            >
              <Text style={{ fontSize: 14, color: colors.ink, fontFamily: fonts.bodySemiBold }}>
                🇬🇭 +233
              </Text>
              <View
                style={{ width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 8 }}
              />
              <TextInput
                keyboardType="phone-pad"
                onChangeText={(v) => {
                  setPhone(v);
                  setError(null);
                }}
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
          ) : (
            <View
              style={{
                height: 52,
                paddingHorizontal: 14,
                justifyContent: 'center',
                backgroundColor: colors.surface,
                borderWidth: 1.5,
                borderColor: colors.border,
                borderRadius: 14,
              }}
            >
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                onChangeText={(v) => {
                  setEmail(v);
                  setError(null);
                }}
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                style={{ fontSize: 16, fontFamily: fonts.body, color: colors.ink }}
                value={email}
              />
            </View>
          )}

          <Text style={{ marginTop: 8, fontSize: 11.5, color: colors.muted }}>
            {method === 'phone'
              ? "We'll send a one-time code via SMS. MTN, Telecel, AirtelTigo supported."
              : "We'll email you a one-time code. Use the email linked to your account."}
          </Text>

          {error ? (
            <View style={{ marginTop: 8 }}>
              <StatusMessage message={error} tone="error" />
            </View>
          ) : null}

          <View style={{ height: spacing.md }} />

          <Button disabled={!canSubmit} label="Send code" loading={loading} onPress={submit} />

          {method === 'phone' &&
          biometricAvailable &&
          biometricEnabled &&
          isAuthenticated() ? (
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

          {/* Other sign-in methods */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginTop: spacing.lg,
              marginBottom: spacing.sm,
            }}
          >
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
            <Text style={{ marginHorizontal: 10, fontSize: 11.5, color: colors.muted }}>or</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          </View>

          <GoogleSignInButton
            mode="login"
            onError={setError}
            onLoginSuccess={(data) => {
              queryClient.clear();
              void resetScopedLocalData();
              setAuth({
                accessToken: data.access_token,
                refreshToken: data.refresh_token,
                user: { id: data.user_id, phone: '', name: '' },
                businessId: data.business_id,
                role: data.role,
              });
              if (!data.business_id) {
                router.replace('/onboarding/business');
              } else {
                router.replace(
                  getHomeRouteForRole(data.role === 'platform_admin' ? 'owner' : data.role)
                );
              }
            }}
            onNotLinked={setError}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
