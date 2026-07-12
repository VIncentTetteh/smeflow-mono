jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import PipelineScreen from '../../app/agent/pipeline';
import { useAgentTraders } from '@/api/hooks/featureHooks';

const mockPush = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('@/api/hooks/featureHooks', () => ({
  useAgentTraders: jest.fn(),
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

const mockTraders = useAgentTraders as jest.Mock;

describe('Agent pipeline screen', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockSearchParams = {};
  });

  it('shows a loading message while traders are being fetched', () => {
    mockTraders.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { getByText } = render(<PipelineScreen />);
    expect(getByText('Loading traders…')).toBeTruthy();
  });

  it('shows a retryable error state instead of "no traders match" on fetch failure', () => {
    mockTraders.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    const { getByText, queryByText } = render(<PipelineScreen />);
    expect(getByText('Could not load pipeline')).toBeTruthy();
    expect(getByText('Check your connection and pull down to retry.')).toBeTruthy();
    expect(queryByText('No traders match your search.')).toBeNull();
  });

  it('shows the empty state when there are genuinely no traders', () => {
    mockTraders.mockReturnValue({ isLoading: false, isError: false, data: [] });
    const { getByText } = render(<PipelineScreen />);
    expect(getByText('No traders yet.')).toBeTruthy();
  });

  it('filters traders by name or phone as the user types', () => {
    mockTraders.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [
        { id: 't1', business_id: 'biz-1', business_name: 'Adwoa Store', phone: '+233240000001', kyc_status: 'verified', status: 'active' },
        { id: 't2', business_id: 'biz-2', business_name: 'Kofi Mart', phone: '+233240000002', kyc_status: 'pending', status: 'registered' },
      ],
    });
    const { getByPlaceholderText, getByText, queryByText } = render(<PipelineScreen />);
    expect(getByText('Adwoa Store')).toBeTruthy();
    expect(getByText('Kofi Mart')).toBeTruthy();

    fireEvent.changeText(getByPlaceholderText('Search trader or phone'), 'kofi');
    expect(queryByText('Adwoa Store')).toBeNull();
    expect(getByText('Kofi Mart')).toBeTruthy();
  });

  it('shows "no traders match your search" (not the generic empty state) when a search yields nothing', () => {
    mockTraders.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{ id: 't1', business_id: 'biz-1', business_name: 'Adwoa Store', phone: '+233240000001', kyc_status: 'verified', status: 'active' }],
    });
    const { getByPlaceholderText, getByText, queryByText } = render(<PipelineScreen />);
    fireEvent.changeText(getByPlaceholderText('Search trader or phone'), 'nonexistent');
    expect(getByText('No traders match your search.')).toBeTruthy();
    expect(queryByText('No traders yet.')).toBeNull();
  });

  it('shows the correct KYC and referral labels per trader', () => {
    mockTraders.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{ id: 't1', business_id: 'biz-1', business_name: 'Adwoa Store', phone: '', kyc_status: 'failed', status: 'churned' }],
    });
    const { getByText } = render(<PipelineScreen />);
    expect(getByText('Needs resubmission')).toBeTruthy();
    expect(getByText('Churned')).toBeTruthy();
  });

  it('navigates to trader detail when a row is tapped', () => {
    mockTraders.mockReturnValue({
      isLoading: false,
      isError: false,
      data: [{ id: 't1', business_id: 'biz-1', business_name: 'Adwoa Store', phone: '+233240000001', kyc_status: 'verified', status: 'active' }],
    });
    const { getByText } = render(<PipelineScreen />);
    fireEvent.press(getByText('Adwoa Store'));
    expect(mockPush).toHaveBeenCalledWith('/agent/trader/biz-1');
  });
});
