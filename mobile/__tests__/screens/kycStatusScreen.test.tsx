jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import KycStatusScreen from '../../app/owner/kyc-status';
import { apiClient } from '@/api/client';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/api/client', () => ({
  apiClient: { get: jest.fn() },
}));

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

const mockGet = apiClient.get as jest.Mock;

function renderScreen() {
  const queryClient = new QueryClient({
    // The screen's own useQuery calls hardcode retry: 2, which wins over a
    // defaultOptions retry override — but retryDelay isn't set on the query,
    // so zeroing it here keeps retry-exhaustion tests fast instead of waiting
    // through react-query's default exponential backoff.
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KycStatusScreen />
    </QueryClientProvider>
  );
}

describe('KYC status screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockGet.mockReset();
  });

  it('shows not_submitted state for a fresh business/user and offers to start both flows', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/kyc/me') {
        const err = new Error('Not Found') as Error & { response: { status: number } };
        err.response = { status: 404 };
        return Promise.reject(err);
      }
      if (url === '/api/v1/auth/kyc/status') {
        return Promise.resolve({ data: { user_id: 'u1', kyc_status: 'unverified' } });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const { getByText, getAllByText } = renderScreen();

    await waitFor(() => expect(getByText('Start business verification')).toBeTruthy());
    expect(getByText('Submit Ghana Card')).toBeTruthy();
    // Both business and personal sections show "Not submitted" independently.
    expect(getAllByText('Not submitted')).toHaveLength(2);
  });

  it('shows verified business and pending personal KYC independently', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/kyc/me') {
        return Promise.resolve({
          data: {
            id: 'kyc-1', business_id: 'biz-1', user_id: 'u1',
            ghana_card_id: null, tin: 'C0012345678', business_registration_ref: 'BN-1',
            status: 'verified', provider: 'test', provider_ref: null, failure_reason: null,
            documents: [], submitted_at: '2026-06-01T00:00:00Z', reviewed_at: '2026-06-02T00:00:00Z',
          },
        });
      }
      if (url === '/api/v1/auth/kyc/status') {
        return Promise.resolve({ data: { user_id: 'u1', kyc_status: 'pending' } });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const { getByText, queryByText } = renderScreen();

    await waitFor(() => expect(getByText('Verified on 6/2/2026')).toBeTruthy());
    expect(getByText('Personal verification in progress — usually takes a few minutes.')).toBeTruthy();
    expect(queryByText('Start business verification')).toBeNull();
  });

  it('shows a retryable error state instead of crashing when business KYC status fails to load', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/kyc/me') {
        return Promise.reject(new Error('Network Error'));
      }
      if (url === '/api/v1/auth/kyc/status') {
        return Promise.resolve({ data: { user_id: 'u1', kyc_status: 'unverified' } });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const { getByText } = renderScreen();

    await waitFor(() =>
      expect(getByText('Could not load status. Check your connection and pull down to retry.')).toBeTruthy()
    );
  });

  it('shows re-submit action when business KYC failed', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url === '/api/v1/kyc/me') {
        return Promise.resolve({
          data: {
            id: 'kyc-1', business_id: 'biz-1', user_id: 'u1',
            ghana_card_id: null, tin: null, business_registration_ref: 'BN-1',
            status: 'failed', provider: 'test', provider_ref: null,
            failure_reason: 'Business registration number could not be verified.',
            documents: [], submitted_at: '2026-06-01T00:00:00Z', reviewed_at: null,
          },
        });
      }
      if (url === '/api/v1/auth/kyc/status') {
        return Promise.resolve({ data: { user_id: 'u1', kyc_status: 'unverified' } });
      }
      return Promise.reject(new Error(`unexpected url ${url}`));
    });

    const { getByText } = renderScreen();

    await waitFor(() =>
      expect(getByText('Business registration number could not be verified.')).toBeTruthy()
    );
    expect(getByText('Re-submit business KYC')).toBeTruthy();
  });
});
