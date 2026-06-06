import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { OTPInput, PhoneInput, StyledTextInput } from '@/components/ui/Inputs';

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#1f6a4f',
      border: '#e8e5de',
      surface: '#fff',
      muted: '#6b6860',
      ink: '#2a2a22',
      text: '#2a2a22',
      bg: '#faf8f3',
      danger: '#d03514',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
      mono: 'JetBrainsMono_400Regular',
    },
    radii: { md: 10 },
    spacing: { xs: 4, sm: 8, md: 16 },
  }),
}));

describe('StyledTextInput', () => {
  it('renders without crashing', () => {
    const { getByPlaceholderText } = render(
      <StyledTextInput placeholder="Enter text" />
    );
    expect(getByPlaceholderText('Enter text')).toBeTruthy();
  });

  it('renders a label when provided', () => {
    const { getByText } = render(
      <StyledTextInput label="Business name" placeholder="Acme Ltd" />
    );
    expect(getByText('Business name')).toBeTruthy();
  });

  it('renders an error message when provided', () => {
    const { getByText } = render(
      <StyledTextInput placeholder="x" error="Required field" />
    );
    expect(getByText('Required field')).toBeTruthy();
  });
});

describe('PhoneInput', () => {
  it('renders Ghana +233 prefix', () => {
    const { getByText } = render(
      <PhoneInput value="" onChangeText={() => {}} />
    );
    expect(getByText('GH +233')).toBeTruthy();
  });

  it('keeps enough digits to normalize 0-prefixed local numbers', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <PhoneInput value="" onChangeText={onChangeText} />
    );
    fireEvent.changeText(getByPlaceholderText('24 000 0000'), '024-123-4567');
    expect(onChangeText).toHaveBeenCalledWith('0241234567');
  });

  it('keeps enough digits to normalize +233 numbers', () => {
    const onChangeText = jest.fn();
    const { getByPlaceholderText } = render(
      <PhoneInput value="" onChangeText={onChangeText} />
    );
    fireEvent.changeText(getByPlaceholderText('24 000 0000'), '+233 24 123 4567');
    expect(onChangeText).toHaveBeenCalledWith('233241234567');
  });

  it('renders an error state', () => {
    const { getByText } = render(
      <PhoneInput value="" onChangeText={() => {}} error="Enter a valid number" />
    );
    expect(getByText('Enter a valid number')).toBeTruthy();
  });
});

describe('OTPInput', () => {
  it('renders 6 input cells', () => {
    const { getByTestId } = render(
      <OTPInput value="" onChange={() => {}} />
    );
    for (let i = 0; i < 6; i += 1) {
      expect(getByTestId(`otp-input-cell-${i}`)).toBeTruthy();
    }
  });

  it('keeps only digits and calls onComplete when full', () => {
    const onChange = jest.fn();
    const onComplete = jest.fn();
    const { getByTestId } = render(
      <OTPInput value="" onChange={onChange} onComplete={onComplete} />
    );
    fireEvent.changeText(getByTestId('otp-input'), '12a34b56');
    expect(onChange).toHaveBeenCalledWith('123456');
    expect(onComplete).toHaveBeenCalledWith('123456');
  });

  it('supports custom OTP length', () => {
    const { getByTestId, queryByTestId } = render(
      <OTPInput value="1234" onChange={() => {}} length={4} testID="pin" />
    );
    expect(getByTestId('pin-cell-3')).toBeTruthy();
    expect(queryByTestId('pin-cell-4')).toBeNull();
  });
});
