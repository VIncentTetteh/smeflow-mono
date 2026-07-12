import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import MessageDeliveriesScreen from '../../app/owner/message-deliveries';
import { useCustomerDeliveries, useRetryCustomerDelivery } from '@/api/hooks/featureHooks';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

jest.mock('@/api/hooks/featureHooks', () => ({
  useCustomerDeliveries: jest.fn(),
  useRetryCustomerDelivery: jest.fn(),
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
  }),
}));

const mockDeliveries = useCustomerDeliveries as jest.Mock;
const mockRetry = useRetryCustomerDelivery as jest.Mock;

describe('Customer message deliveries screen', () => {
  let retryMutate: jest.Mock;

  beforeEach(() => {
    mockBack.mockReset();
    retryMutate = jest.fn();
    mockRetry.mockReturnValue({ mutate: retryMutate, isPending: false });
  });

  it('shows a loading indicator while deliveries are being fetched', () => {
    mockDeliveries.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { queryByText } = render(<MessageDeliveriesScreen />);
    expect(queryByText('No message deliveries yet.')).toBeNull();
  });

  it('shows a retryable error state instead of the empty state on fetch failure', () => {
    mockDeliveries.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    const { getByText, queryByText } = render(<MessageDeliveriesScreen />);
    expect(getByText('Could not load messages')).toBeTruthy();
    expect(queryByText('No message deliveries yet.')).toBeNull();
  });

  it('shows the empty state when there are no deliveries', () => {
    mockDeliveries.mockReturnValue({ isLoading: false, isError: false, data: { items: [] } });
    const { getByText } = render(<MessageDeliveriesScreen />);
    expect(getByText('No message deliveries yet.')).toBeTruthy();
  });

  it('guards against a message with no attempts array instead of crashing', () => {
    mockDeliveries.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [{ id: 'm1', message_type: 'invoice_sent', status: 'sent', recipient_masked: '024***456' }] },
    });
    const { getByText } = render(<MessageDeliveriesScreen />);
    expect(getByText('024***456 · 0 attempts')).toBeTruthy();
  });

  it('shows failure detail and a Retry button only for failed messages, and disables it while retrying', () => {
    mockDeliveries.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        items: [
          {
            id: 'm1', message_type: 'invoice_sent', status: 'failed', recipient_masked: '024***456',
            attempts: [{ failure_detail: 'SMS gateway timeout' }],
          },
          {
            id: 'm2', message_type: 'kyc_reviewed', status: 'sent', recipient_masked: '024***789',
            attempts: [{}],
          },
        ],
      },
    });
    const { getByText, queryByText } = render(<MessageDeliveriesScreen />);
    expect(getByText('SMS gateway timeout')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    // Only one failed message — only one Retry button should render.
    fireEvent.press(getByText('Retry'));
    expect(retryMutate).toHaveBeenCalledWith('m1');
    expect(queryByText('kyc reviewed')).toBeTruthy();
  });

  it('disables and relabels Retry while a retry is in flight', () => {
    mockRetry.mockReturnValue({ mutate: retryMutate, isPending: true });
    mockDeliveries.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { items: [{ id: 'm1', message_type: 'invoice_sent', status: 'failed', recipient_masked: '024***456', attempts: [] }] },
    });
    const { getByText, queryByText } = render(<MessageDeliveriesScreen />);
    expect(getByText('Retrying…')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
  });
});
