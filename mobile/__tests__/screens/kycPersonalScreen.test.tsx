jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import KycPersonalScreen from '../../app/owner/kyc-personal';
import { submitUserKyc } from '@/api/auth.api';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

jest.mock('@/api/auth.api', () => ({
  submitUserKyc: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return { MaterialCommunityIcons: ({ name }: { name: string }) => ReactActual.createElement(Text, null, name) };
});

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f',
      ink: '#2a2a22', muted: '#6b6860', danger: '#b42318',
    },
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif' },
    spacing: { sm: 8, md: 16, lg: 24 },
    radii: { md: 10 },
  }),
}));

const mockSubmit = submitUserKyc as jest.Mock;

describe('Personal KYC (Ghana Card) submission screen', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockSubmit.mockReset();
  });

  it('auto-formats raw digits into GHA-XXXXXXXXX-X as the user types', () => {
    const { getByPlaceholderText } = render(<KycPersonalScreen />);
    const input = getByPlaceholderText('GHA-123456789-0');
    fireEvent.changeText(input, 'gha1234567891');
    expect(input.props.value).toBe('GHA-123456789-1');
  });

  it('blocks submission and shows an error for an incomplete Ghana Card', () => {
    const { getByPlaceholderText, getByText } = render(<KycPersonalScreen />);
    fireEvent.changeText(getByPlaceholderText('GHA-123456789-0'), 'GHA123');
    fireEvent.press(getByText('Submit Ghana Card'));
    expect(getByText('Enter Ghana Card in the format GHA-123456789-0.')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('submits a well-formed Ghana Card and navigates back', async () => {
    mockSubmit.mockResolvedValue({
      user_id: 'u1', kyc_status: 'pending',
      kyc_submitted_at: '2026-07-01T00:00:00Z', kyc_verified_at: null,
    });

    const { getByPlaceholderText, getByText } = render(<KycPersonalScreen />);
    fireEvent.changeText(getByPlaceholderText('GHA-123456789-0'), 'GHA1234567890');
    fireEvent.press(getByText('Submit Ghana Card'));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({ ghana_card_id: 'GHA-123456789-0' });
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('shows the API error message and does not navigate back when already pending/verified', async () => {
    mockSubmit.mockRejectedValue(new Error("KYC already pending. Contact support if you need to update your documents."));

    const { getByPlaceholderText, getByText } = render(<KycPersonalScreen />);
    fireEvent.changeText(getByPlaceholderText('GHA-123456789-0'), 'GHA1234567890');
    fireEvent.press(getByText('Submit Ghana Card'));

    await waitFor(() =>
      expect(getByText('KYC already pending. Contact support if you need to update your documents.')).toBeTruthy()
    );
    expect(mockBack).not.toHaveBeenCalled();
  });
});
