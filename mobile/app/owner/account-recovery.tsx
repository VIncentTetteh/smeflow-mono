import { useState } from 'react';
import { View } from 'react-native';
import { initiatePhoneChange, confirmPhoneChange } from '@/api/auth.api';
import { toApiErrorMessage } from '@/api/errors';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StyledTextInput } from '@/components/ui/Inputs';
import { Screen, SectionHeader } from '@/components/ui/Screen';
import { StatusMessage } from '@/components/ui/StatusMessage';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';

function normalizeGhanaPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('233') ? digits.slice(3) : digits.replace(/^0/, '');
  return local.length === 9 ? `+233${local}` : null;
}

export default function AccountRecoveryScreen() {
  const [newPhone, setNewPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [loadingStep, setLoadingStep] = useState<'initiate' | 'confirm' | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { colors, spacing } = useTheme();
  const normalizedPhone = normalizeGhanaPhone(newPhone);

  async function initiate() {
    if (!normalizedPhone) {
      setError('Enter a valid new Ghana phone number.');
      return;
    }
    setLoadingStep('initiate');
    setError(null);
    setStatus(null);
    try {
      const response = await initiatePhoneChange({ new_phone: normalizedPhone });
      setStatus(response.message);
    } catch (initiateError) {
      setError(toApiErrorMessage(initiateError));
    } finally {
      setLoadingStep(null);
    }
  }

  async function confirm() {
    if (!normalizedPhone || otp.length !== 6) {
      setError('Enter the new phone number and the six-digit code sent to it.');
      return;
    }
    setLoadingStep('confirm');
    setError(null);
    try {
      const response = await confirmPhoneChange({ new_phone: normalizedPhone, otp });
      setStatus(response.message);
      setOtp('');
    } catch (confirmError) {
      setError(toApiErrorMessage(confirmError));
    } finally {
      setLoadingStep(null);
    }
  }

  return (
    <Screen>
      <SectionHeader
        title="Phone account recovery"
        subtitle="Change your sign-in phone number while authenticated"
      />
      <Card style={{ gap: spacing.md }}>
        <Text style={{ color: colors.muted }}>
          SMEflow does not use passwords. To change your login phone, request a code to the
          new number, then confirm ownership with that code.
        </Text>
        <StyledTextInput
          keyboardType="phone-pad"
          label="New phone number"
          onChangeText={(value) => {
            setNewPhone(value);
            setError(null);
          }}
          placeholder="024 000 0000"
          value={newPhone}
        />
        <Button
          disabled={!normalizedPhone}
          label="Send change code"
          loading={loadingStep === 'initiate'}
          onPress={initiate}
          variant="soft"
        />
        <View style={{ gap: spacing.sm }}>
          <StyledTextInput
            keyboardType="number-pad"
            label="Verification code"
            maxLength={6}
            onChangeText={(value) => setOtp(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            value={otp}
          />
          <Button
            disabled={!normalizedPhone || otp.length !== 6}
            label="Confirm phone change"
            loading={loadingStep === 'confirm'}
            onPress={confirm}
          />
        </View>
        {error ? <StatusMessage message={error} tone="error" /> : null}
        {status ? <StatusMessage message={status} tone="success" /> : null}
      </Card>
    </Screen>
  );
}
