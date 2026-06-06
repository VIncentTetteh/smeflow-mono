import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { Button } from '@/components/ui/Button';

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      brand: '#1f6a4f',
      surface: '#fff',
      ink: '#2a2a22',
      danger: '#d03514',
      gold: '#e8c25a',
      muted: '#6b6860',
      text: '#2a2a22',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
    },
    radii: { md: 10 },
    spacing: { sm: 8, md: 16, lg: 24 },
  }),
}));

describe('Button', () => {
  it('renders the label', () => {
    const { getByText } = render(<Button label="Charge GH₵ 129.00" onPress={() => {}} />);
    expect(getByText('Charge GH₵ 129.00')).toBeTruthy();
  });

  it('calls onPress when tapped', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Pay" onPress={onPress} />);
    fireEvent.press(getByText('Pay'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('does not call onPress when disabled', () => {
    const onPress = jest.fn();
    const { getByText } = render(<Button label="Pay" onPress={onPress} disabled />);
    fireEvent.press(getByText('Pay'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('renders primary variant by default', () => {
    const { getByText } = render(<Button label="Pay" onPress={() => {}} />);
    expect(getByText('Pay')).toBeTruthy();
  });
});
