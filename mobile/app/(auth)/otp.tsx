import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { requestOtp, verifyOtp } from '@/api/auth.api';
import { toApiErrorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { resetScopedLocalData } from '@/db/scopedData';
import { biometricUnlock, isBiometricAvailable } from '@/lib/deviceFeatures';
import { getHomeRouteForRole } from '@/navigation/authRouting';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

const OTP_LENGTH = 4;

export default function OTPScreen() {
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(30);
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const inputRef = useRef<TextInput>(null);
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();
  const queryClient = useQueryClient();
  const setAuth = useAuthStore((state) => state.setAuth);
  const biometricEnabled = useAuthStore((state) => state.biometricEnabled);
  const setBiometricEnabled = useAuthStore((state) => state.setBiometricEnabled);
  const pendingOtpPhone = useAuthStore((state) => state.pendingOtpPhone);

  const routePhone = Array.isArray(phone) ? phone[0] : phone;
  const phoneNumber = routePhone || pendingOtpPhone || '';

  const cells = useMemo(
    () => otp.padEnd(OTP_LENGTH, ' ').split('').slice(0, OTP_LENGTH),
    [otp]
  );

  useEffect(() => {
    if (resendTimer <= 0) return;
    const id = setTimeout(() => setResendTimer((t) => t - 1), 1000);
    return () => clearTimeout(id);
  }, [resendTimer]);

  const verify = useCallback(async (code: string) => {
    if (loading || code.length !== OTP_LENGTH || !phoneNumber) return;
    setLoading(true);
    setError(null);
    try {
      const data = await verifyOtp({ phone: phoneNumber, otp: code });
      queryClient.clear();
      void resetScopedLocalData();
      setAuth({
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        user: { id: data.user_id, phone: phoneNumber, name: '' },
        businessId: data.business_id,
        role: data.role,
      });
      if (!biometricEnabled && await isBiometricAvailable()) {
        Alert.alert('Enable biometric unlock?', 'Use your device biometrics to unlock SMEflow next time.', [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Enable',
            onPress: () => {
              biometricUnlock().then((ok) => {
                if (ok) setBiometricEnabled(true);
              });
            },
          },
        ]);
      }
      if (!data.business_id) {
        router.replace('/onboarding/business');
      } else {
        router.replace(getHomeRouteForRole(data.role === 'platform_admin' ? 'owner' : data.role));
      }
    } catch (verifyError) {
      setError(toApiErrorMessage(verifyError));
      setOtp('');
      inputRef.current?.focus();
    } finally {
      setLoading(false);
    }
  }, [biometricEnabled, loading, phoneNumber, router, setAuth, setBiometricEnabled, queryClient]);

  function handleChange(value: string) {
    const cleaned = value.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(cleaned);
    setError(null);
    if (cleaned.length === OTP_LENGTH) {
      void verify(cleaned);
    }
  }

  async function resendCode() {
    if (resending || !phoneNumber) return;
    setResending(true);
    setError(null);
    try {
      await requestOtp({ phone: phoneNumber });
      setResendTimer(30);
    } catch (resendError) {
      setError(toApiErrorMessage(resendError));
    } finally {
      setResending(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        {/* Header with back arrow */}
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm + 4,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          <TouchableOpacity
            onPress={() => router.back()}
            style={{ marginRight: spacing.sm, padding: 4 }}
          >
            <Text style={{ fontSize: 20, color: colors.ink, lineHeight: 24 }}>←</Text>
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={{
              fontFamily: fonts.displaySemiBold,
              fontSize: 17,
              color: colors.ink,
            }}>
              Enter the 4-digit code
            </Text>
            {phoneNumber ? (
              <Text style={{ fontSize: 12.5, color: colors.muted, marginTop: 1 }}>
                Sent to {phoneNumber}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Body */}
        <View style={{ flex: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md }}>
          {!phoneNumber ? (
            <StatusMessage
              message="Your phone number was not found. Go back and request a new one-time code."
              tone="error"
            />
          ) : null}

          <Pressable onPress={() => inputRef.current?.focus()}>
            <TextInput
              ref={inputRef}
              autoComplete="sms-otp"
              autoFocus
              caretHidden
              keyboardType="number-pad"
              maxLength={OTP_LENGTH}
              onChangeText={handleChange}
              style={{ height: 1, opacity: 0, position: 'absolute', width: 1 }}
              textContentType="oneTimeCode"
              value={otp}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {cells.map((cell, index) => {
                const filled = cell.trim().length > 0;
                const isActive = otp.length === index;
                return (
                  <View
                    key={index}
                    style={{
                      flex: 1,
                      height: 56,
                      borderRadius: 12,
                      backgroundColor: colors.surface,
                      borderWidth: isActive ? 2 : 1.5,
                      borderColor: filled || isActive ? colors.brand : colors.border,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Text style={{
                      fontFamily: fonts.displaySemiBold,
                      fontSize: 24,
                      color: colors.ink,
                    }}>
                      {cell.trim()}
                    </Text>
                  </View>
                );
              })}
            </View>
          </Pressable>

          {/* Resend timer */}
          <View style={{ marginTop: 14 }}>
            {resendTimer > 0 ? (
              <Text style={{ fontSize: 12, color: colors.muted }}>
                Resend in{' '}
                <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.muted }}>
                  0:{resendTimer.toString().padStart(2, '0')}
                </Text>
              </Text>
            ) : (
              <TouchableOpacity disabled={resending} onPress={resendCode}>
                <Text style={{ fontSize: 12, color: colors.brand, fontFamily: fonts.bodySemiBold }}>
                  {resending ? 'Sending…' : 'Resend code'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {error ? (
            <View style={{ marginTop: spacing.sm }}>
              <StatusMessage message={error} tone="error" />
            </View>
          ) : null}

          <View style={{ flex: 1 }} />

          <Button
            disabled={!phoneNumber || otp.length !== OTP_LENGTH}
            label="Continue"
            loading={loading}
            onPress={() => verify(otp)}
          />
          <View style={{ height: 8 }} />
          <TouchableOpacity
            onPress={() => router.replace('/')}
            style={{ paddingVertical: 10, alignItems: 'center' }}
          >
            <Text style={{ fontSize: 12.5, color: colors.muted }}>
              Try a different number
            </Text>
          </TouchableOpacity>
          <View style={{ height: spacing.sm }} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
