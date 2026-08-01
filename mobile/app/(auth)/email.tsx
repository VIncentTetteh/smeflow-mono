import { useState } from 'react';
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
import { requestEmailLogin } from '@/api/auth.api';
import { normalizeApiError } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailLoginScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { colors, fonts, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const setPendingEmailLogin = useAuthStore((state) => state.setPendingEmailLogin);
  const normalizedEmail = email.trim().toLowerCase();
  const isValid = EMAIL_PATTERN.test(normalizedEmail);

  async function submit() {
    if (loading || !isValid) return;
    setLoading(true);
    setError(null);
    try {
      await requestEmailLogin({ email: normalizedEmail });
      setPendingEmailLogin(normalizedEmail);
      router.push({ pathname: '/email-otp', params: { email: normalizedEmail } });
    } catch (requestError) {
      setError(normalizeApiError(requestError).message);
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
          <TouchableOpacity onPress={() => router.back()} style={{ paddingVertical: 4 }}>
            <Text style={{ fontSize: 20, color: colors.ink }}>←</Text>
          </TouchableOpacity>

          <Text style={{
            marginTop: spacing.lg,
            fontSize: 26,
            fontFamily: fonts.displaySemiBold,
            color: colors.ink,
            lineHeight: 32,
            letterSpacing: -0.5,
          }}>
            Sign in with email
          </Text>
          <Text style={{ marginTop: 8, fontSize: 14, color: colors.muted, lineHeight: 21 }}>
            Enter the email you linked to your SMEflow account. We'll send you a code.
          </Text>

          <View style={{ height: spacing.lg }} />

          <Text style={{
            fontSize: 11.5,
            color: colors.muted,
            fontFamily: fonts.bodySemiBold,
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 6,
          }}>
            Email address
          </Text>
          <View style={{
            height: 52,
            paddingHorizontal: 14,
            justifyContent: 'center',
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: colors.border,
            borderRadius: 14,
          }}>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              autoFocus
              keyboardType="email-address"
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              style={{ fontSize: 16, fontFamily: fonts.body, color: colors.ink }}
              value={email}
            />
          </View>

          {error ? (
            <View style={{ marginTop: 8 }}>
              <StatusMessage message={error} tone="error" />
            </View>
          ) : null}

          <View style={{ flex: 1, minHeight: spacing.lg }} />

          <Button disabled={!isValid} label="Send code" loading={loading} onPress={submit} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
