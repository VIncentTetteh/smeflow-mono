import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MomoScreen from '../../app/(auth)/onboarding/momo';
import { addMomoAccount } from '@/api/business.api';

const mockPush = jest.fn();
const mockBack = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

jest.mock('@/api/business.api', () => ({
  addMomoAccount: jest.fn(),
}));

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f',
      ink: '#2a2a22', muted: '#6b6860', danger: '#d03514',
    },
    fonts: {
      body: 'Inter_400Regular', bodySemiBold: 'Inter_600SemiBold', displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { md: 10 },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24 },
  }),
}));

const mockAddMomo = addMomoAccount as jest.Mock;

describe('MoMo wallet linking onboarding step', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockBack.mockReset();
    mockAddMomo.mockReset();
  });

  it('skips linking and continues onboarding when phone is left blank', async () => {
    const { getByText } = render(<MomoScreen />);
    fireEvent.press(getByText('Continue · Identity'));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/kyc'));
    expect(mockAddMomo).not.toHaveBeenCalled();
  });

  it('rejects an invalid Ghana phone number instead of silently skipping', async () => {
    const { getByPlaceholderText, getByText } = render(<MomoScreen />);
    fireEvent.changeText(getByPlaceholderText('024 000 0000'), '123');
    fireEvent.press(getByText('Continue · Identity'));
    await waitFor(() =>
      expect(getByText('Enter a valid Ghana phone number for this wallet.')).toBeTruthy()
    );
    expect(mockAddMomo).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('normalizes a local 0-prefixed number and links the default MTN provider', async () => {
    mockAddMomo.mockResolvedValue({ id: 'acc-1' });
    const { getByPlaceholderText, getByText } = render(<MomoScreen />);
    fireEvent.changeText(getByPlaceholderText('024 000 0000'), '0244123456');
    fireEvent.press(getByText('Continue · Identity'));

    await waitFor(() => {
      expect(mockAddMomo).toHaveBeenCalledWith({
        provider: 'mtn',
        phone: '+233244123456',
        account_name: undefined,
        is_primary: true,
      });
    });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/onboarding/kyc'));
  });

  it('links the selected provider (not always MTN) with a trimmed account name', async () => {
    mockAddMomo.mockResolvedValue({ id: 'acc-1' });
    const { getByPlaceholderText, getByText } = render(<MomoScreen />);
    fireEvent.press(getByText('Telecel Cash'));
    fireEvent.changeText(getByPlaceholderText('024 000 0000'), '0201234567');
    fireEvent.changeText(getByPlaceholderText('Optional'), '  Kofi Shop  ');
    fireEvent.press(getByText('Continue · Identity'));

    await waitFor(() => {
      expect(mockAddMomo).toHaveBeenCalledWith({
        provider: 'vodafone',
        phone: '+233201234567',
        account_name: 'Kofi Shop',
        is_primary: true,
      });
    });
  });

  it('shows the API error and does not advance the wizard on failure', async () => {
    mockAddMomo.mockRejectedValue(new Error('This number is already linked to another business.'));
    const { getByPlaceholderText, getByText } = render(<MomoScreen />);
    fireEvent.changeText(getByPlaceholderText('024 000 0000'), '0244123456');
    fireEvent.press(getByText('Continue · Identity'));

    await waitFor(() =>
      expect(getByText('This number is already linked to another business.')).toBeTruthy()
    );
    expect(mockPush).not.toHaveBeenCalled();
  });
});
