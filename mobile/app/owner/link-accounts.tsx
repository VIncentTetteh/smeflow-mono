import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { confirmEmailLink, requestEmailLink } from '@/api/auth.api';
import { toApiErrorMessage } from '@/api/errors';
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StyledTextInput } from '@/components/ui/Inputs';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LinkAccountsScreen() {
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [loadingStep, setLoadingStep] = useState<'initiate' | 'confirm' | null>(null);
  const [emailStatus, setEmailStatus] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [googleStatus, setGoogleStatus] = useState<string | null>(null);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const { colors, fonts, spacing } = useTheme();
  const user = useAuthStore((s) => s.user);
  const setSessionContext = useAuthStore((s) => s.setSessionContext);
  const normalizedEmail = email.trim().toLowerCase();
  const isValidEmail = EMAIL_PATTERN.test(normalizedEmail);

  async function initiateEmail() {
    if (!isValidEmail) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setLoadingStep('initiate');
    setEmailError(null);
    setEmailStatus(null);
    try {
      const response = await requestEmailLink({ email: normalizedEmail });
      setEmailStatus(response.message);
    } catch (initiateError) {
      setEmailError(toApiErrorMessage(initiateError));
    } finally {
      setLoadingStep(null);
    }
  }

  async function confirmEmail() {
    if (!isValidEmail || otp.length !== 4) {
      setEmailError('Enter your email and the 4-digit code sent to it.');
      return;
    }
    setLoadingStep('confirm');
    setEmailError(null);
    try {
      const updatedUser = await confirmEmailLink({ email: normalizedEmail, otp });
      setSessionContext({ user: { ...(user ?? { id: updatedUser.id, phone: updatedUser.phone, name: updatedUser.name ?? '' }), email: updatedUser.email } });
      setEmailStatus('Email linked. You can now sign in with this email too.');
      setOtp('');
    } catch (confirmError) {
      setEmailError(toApiErrorMessage(confirmError));
    } finally {
      setLoadingStep(null);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>
          Sign-in methods
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          Link an email or Google account so you can sign in without your phone
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card style={{ gap: spacing.md }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>Email</Text>
        <Text style={{ color: colors.muted }}>
          {user?.email ? `Linked: ${user.email}` : 'Link an email to sign in without your phone number.'}
        </Text>
        <StyledTextInput
          autoCapitalize="none"
          keyboardType="email-address"
          label="Email address"
          onChangeText={(value) => { setEmail(value); setEmailError(null); }}
          placeholder="you@example.com"
          value={email}
        />
        <Button
          disabled={!isValidEmail}
          label="Send verification code"
          loading={loadingStep === 'initiate'}
          onPress={initiateEmail}
          variant="soft"
        />
        <View style={{ gap: spacing.sm }}>
          <StyledTextInput
            keyboardType="number-pad"
            label="Verification code"
            maxLength={4}
            onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 4))}
            placeholder="1234"
            value={otp}
          />
          <Button
            disabled={!isValidEmail || otp.length !== 4}
            label="Confirm email"
            loading={loadingStep === 'confirm'}
            onPress={confirmEmail}
          />
        </View>
        {emailError ? <StatusMessage message={emailError} tone="error" /> : null}
        {emailStatus ? <StatusMessage message={emailStatus} tone="success" /> : null}
      </Card>

      <Card style={{ gap: spacing.md }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>Google</Text>
        <Text style={{ color: colors.muted }}>
          {user?.googleLinked ? 'Linked.' : 'Link your Google account for one-tap sign-in.'}
        </Text>
        <GoogleSignInButton
          mode="link"
          onError={setGoogleError}
          onLinkSuccess={(updatedUser) => {
            setSessionContext({
              user: {
                ...(user ?? { id: updatedUser.id, phone: updatedUser.phone, name: updatedUser.name ?? '' }),
                email: updatedUser.email,
                googleLinked: updatedUser.google_linked,
              },
            });
            setGoogleStatus('Google account linked. You can now sign in with Google too.');
            setGoogleError(null);
          }}
        />
        {googleError ? <StatusMessage message={googleError} tone="error" /> : null}
        {googleStatus ? <StatusMessage message={googleStatus} tone="success" /> : null}
      </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
