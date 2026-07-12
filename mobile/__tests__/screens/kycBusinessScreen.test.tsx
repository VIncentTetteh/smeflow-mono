jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import KycBusinessScreen from '../../app/owner/kyc-business';
import { submitBusinessKyc } from '@/api/business.api';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

jest.mock('@/api/business.api', () => ({
  submitBusinessKyc: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return { MaterialCommunityIcons: ({ name }: { name: string }) => ReactActual.createElement(Text, null, name) };
});

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    SafeAreaView: actual.SafeAreaView,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
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

const mockSubmit = submitBusinessKyc as jest.Mock;

describe('Business KYC submission screen', () => {
  beforeEach(() => {
    mockBack.mockReset();
    mockSubmit.mockReset();
  });

  it('blocks submission and shows an error when business registration number is empty', () => {
    const { getByText, queryByText } = render(<KycBusinessScreen />);
    fireEvent.press(getByText('Start business verification'));
    expect(getByText('Business registration number is required.')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(queryByText(/could not/i)).toBeNull();
  });

  it('rejects a TIN that is not exactly 11 digits', () => {
    const { getByPlaceholderText, getByText } = render(<KycBusinessScreen />);
    fireEvent.changeText(getByPlaceholderText('BN-12345678'), 'BN-99999999');
    fireEvent.changeText(getByPlaceholderText('12345678901'), '123');
    fireEvent.press(getByText('Start business verification'));
    expect(getByText('TIN must be exactly 11 digits.')).toBeTruthy();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('strips non-digit characters from the TIN field as the user types', () => {
    const { getByPlaceholderText } = render(<KycBusinessScreen />);
    const tinInput = getByPlaceholderText('12345678901');
    fireEvent.changeText(tinInput, '123-456-789a01');
    expect(tinInput.props.value).toBe('12345678901');
  });

  it('submits with a trimmed business reg ref and optional TIN, then navigates back', async () => {
    mockSubmit.mockResolvedValue({
      id: 'kyc-1', business_id: 'biz-1', user_id: 'u1',
      ghana_card_id: null, tin: '12345678901', business_registration_ref: 'BN-99999999',
      status: 'pending', provider: null, provider_ref: null, failure_reason: null,
      documents: [], submitted_at: '2026-07-01T00:00:00Z', reviewed_at: null,
    });

    const { getByPlaceholderText, getByText } = render(<KycBusinessScreen />);
    fireEvent.changeText(getByPlaceholderText('BN-12345678'), '  BN-99999999  ');
    fireEvent.changeText(getByPlaceholderText('12345678901'), '12345678901');
    fireEvent.press(getByText('Start business verification'));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        business_registration_ref: 'BN-99999999',
        tin: '12345678901',
        documents: [],
      });
    });
    await waitFor(() => expect(mockBack).toHaveBeenCalled());
  });

  it('submits with tin undefined when left blank', async () => {
    mockSubmit.mockResolvedValue({
      id: 'kyc-1', business_id: 'biz-1', user_id: 'u1',
      ghana_card_id: null, tin: null, business_registration_ref: 'BN-1',
      status: 'pending', provider: null, provider_ref: null, failure_reason: null,
      documents: [], submitted_at: '2026-07-01T00:00:00Z', reviewed_at: null,
    });

    const { getByPlaceholderText, getByText } = render(<KycBusinessScreen />);
    fireEvent.changeText(getByPlaceholderText('BN-12345678'), 'BN-1');
    fireEvent.press(getByText('Start business verification'));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledWith({
        business_registration_ref: 'BN-1',
        tin: undefined,
        documents: [],
      });
    });
  });

  it('shows the API error message and does not navigate back on failure', async () => {
    mockSubmit.mockRejectedValue(new Error('Business already has a pending KYC review.'));

    const { getByPlaceholderText, getByText } = render(<KycBusinessScreen />);
    fireEvent.changeText(getByPlaceholderText('BN-12345678'), 'BN-1');
    fireEvent.press(getByText('Start business verification'));

    await waitFor(() => expect(getByText('Business already has a pending KYC review.')).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
  });
});
