import React from 'react';
import { fireEvent, render, waitFor, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { requestOtp } from '@/api/auth.api';
import OTPScreen from '../../app/(auth)/otp';

jest.mock('expo-router', () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({
    back: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock('@/api/auth.api', () => ({
  requestOtp: jest.fn(),
  verifyOtp: jest.fn(),
}));

jest.mock('react-native-safe-area-context', () => {
  const actual = jest.requireActual('react-native-safe-area-context');
  return {
    ...actual,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
  };
});

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3',
      surface: '#fff',
      border: '#e8e5de',
      brand: '#1f6a4f',
      ink: '#2a2a22',
      muted: '#6b6860',
      danger: '#d03514',
    },
    fonts: {
      body: 'Inter_400Regular',
      bodySemiBold: 'Inter_600SemiBold',
      displaySemiBold: 'SourceSerif4_600SemiBold',
    },
    radii: { md: 10 },
    spacing: { sm: 8, md: 16, lg: 24 },
  }),
}));

describe('OTP resend', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    (useLocalSearchParams as jest.Mock).mockReturnValue({ phone: '+233241234567' });
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  function expireResendTimer() {
    for (let i = 0; i < 30; i += 1) {
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
    }
  }

  function renderScreen() {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <OTPScreen />
      </QueryClientProvider>
    );
  }

  it('requests a new OTP and restarts the resend timer after success', async () => {
    (requestOtp as jest.Mock).mockResolvedValue({ message: 'sent' });
    const { getByText, queryByText } = renderScreen();

    expireResendTimer();

    fireEvent.press(getByText('Resend code'));

    await waitFor(() => {
      expect(requestOtp).toHaveBeenCalledWith({ phone: '+233241234567' });
    });
    await waitFor(() => {
      expect(queryByText('Resend code')).toBeNull();
    });
  });

  it('shows the resend error and does not restart the timer when resend fails', async () => {
    (requestOtp as jest.Mock).mockRejectedValue(new Error('SMS gateway unavailable'));
    const { getByText } = renderScreen();

    expireResendTimer();

    fireEvent.press(getByText('Resend code'));

    await waitFor(() => {
      expect(getByText('SMS gateway unavailable')).toBeTruthy();
    });
    expect(getByText('Resend code')).toBeTruthy();
  });
});
