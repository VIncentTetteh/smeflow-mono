import { useRef } from 'react';
import {
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Text } from './Text';
import { useTheme } from '@/lib/theme';

interface StyledInputProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: ViewStyle;
  inputStyle?: TextStyle;
}

export function StyledTextInput({
  label,
  error,
  containerStyle,
  inputStyle,
  ...props
}: StyledInputProps) {
  const { colors, fonts, radii, spacing } = useTheme();
  const errorId = error ? `${props.testID ?? 'text-input'}-error` : undefined;

  return (
    <View style={containerStyle}>
      {label ? (
        <Text
          style={{
            color: colors.muted,
            fontFamily: fonts.bodySemiBold,
            fontSize: 12,
            marginBottom: spacing.xs,
          }}
        >
          {label}
        </Text>
      ) : null}
      <TextInput
        accessibilityHint={error}
        accessibilityLabel={props.accessibilityLabel ?? label}
        placeholderTextColor={colors.muted}
        style={[
          {
            backgroundColor: colors.surface,
            borderColor: error ? colors.danger : colors.border,
            borderRadius: radii.md,
            borderWidth: 1,
            color: colors.text,
            fontFamily: fonts.body,
            fontSize: 15,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm + 4,
          },
          inputStyle,
        ]}
        {...props}
      />
      {error ? (
        <Text nativeID={errorId} style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

interface PhoneInputProps extends Omit<TextInputProps, 'value'> {
  value: string;
  onChangeText: (text: string) => void;
  error?: string;
}

export function PhoneInput({ value, onChangeText, error, style, ...props }: PhoneInputProps) {
  const { colors, fonts, radii, spacing } = useTheme();

  function handleChange(text: string) {
    onChangeText(text.replace(/\D/g, '').slice(0, 12));
  }

  return (
    <View>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderColor: error ? colors.danger : colors.border,
          borderRadius: radii.md,
          borderWidth: 1,
          flexDirection: 'row',
          overflow: 'hidden',
        }}
      >
        <View
          style={{
            borderRightColor: colors.border,
            borderRightWidth: 1,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.sm + 4,
          }}
        >
          <Text style={{ color: colors.text, fontFamily: fonts.bodySemiBold, fontSize: 15 }}>
            GH +233
          </Text>
        </View>
        <TextInput
          accessibilityHint={error}
          accessibilityLabel={props.accessibilityLabel ?? 'Ghana phone number'}
          keyboardType="phone-pad"
          maxLength={12}
          onChangeText={handleChange}
          placeholder="24 000 0000"
          placeholderTextColor={colors.muted}
          style={[
            {
              color: colors.text,
              flex: 1,
              fontFamily: fonts.body,
              fontSize: 15,
              paddingHorizontal: spacing.md,
              paddingVertical: spacing.sm + 4,
            },
            style,
          ]}
          value={value}
          {...props}
        />
      </View>
      {error ? (
        <Text style={{ color: colors.danger, fontSize: 12, marginTop: 4 }}>{error}</Text>
      ) : null}
    </View>
  );
}

const DEFAULT_OTP_LENGTH = 6;

interface OTPInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  testID?: string;
}

export function OTPInput({
  value,
  onChange,
  onComplete,
  length = DEFAULT_OTP_LENGTH,
  testID = 'otp-input',
}: OTPInputProps) {
  const { colors, fonts, radii, spacing } = useTheme();
  const inputRef = useRef<TextInput>(null);
  const cleanedValue = value.replace(/\D/g, '').slice(0, length);
  const digits = cleanedValue.padEnd(length, ' ').split('');

  function handleChange(text: string) {
    const cleaned = text.replace(/\D/g, '').slice(0, length);
    onChange(cleaned);
    if (cleaned.length === length) {
      onComplete?.(cleaned);
    }
  }

  return (
    <View>
      <TextInput
        accessibilityLabel="One-time passcode"
        autoComplete="sms-otp"
        caretHidden
        importantForAccessibility="no"
        keyboardType="number-pad"
        maxLength={length}
        onChangeText={handleChange}
        ref={inputRef}
        style={[StyleSheet.absoluteFillObject, styles.hiddenInput]}
        testID={testID}
        textContentType="oneTimeCode"
        value={cleanedValue}
      />
      <TouchableOpacity
        activeOpacity={1}
        accessibilityRole="button"
        onPress={() => inputRef.current?.focus()}
        style={{ flexDirection: 'row', gap: spacing.sm }}
      >
        {digits.map((digit, index) => {
          const filled = digit !== ' ';
          const isCursor = index === cleanedValue.length;

          return (
            <View
              key={index}
              testID={`${testID}-cell-${index}`}
              style={{
                alignItems: 'center',
                backgroundColor: colors.surface,
                borderColor: isCursor || filled ? colors.brand : colors.border,
                borderRadius: radii.md,
                borderWidth: 1.5,
                height: 52,
                justifyContent: 'center',
                width: 44,
              }}
            >
              <Text style={{ color: colors.text, fontFamily: fonts.mono, fontSize: 20 }}>
                {filled ? digit : ''}
              </Text>
            </View>
          );
        })}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  hiddenInput: {
    opacity: 0,
    zIndex: -1,
  },
});
