jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import BillingScreen from '../../app/owner/billing';
import { useBillingWorkspace, useCancelSubscription, useSelectPlan } from '@/api/hooks/featureHooks';
import { apiClient } from '@/api/client';
import * as WebBrowser from 'expo-web-browser';

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

jest.mock('expo-web-browser', () => ({
  openBrowserAsync: jest.fn(() => Promise.resolve()),
  WebBrowserPresentationStyle: { FULL_SCREEN: 'FULL_SCREEN' },
}));

jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn() },
}));

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ business: { name: 'Test Shop' } }),
}));

jest.mock('@/api/hooks/featureHooks', () => ({
  useBillingWorkspace: jest.fn(),
  useSelectPlan: jest.fn(),
  useCancelSubscription: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => {
  const ReactActual = require('react');
  const { Text } = require('react-native');
  return { MaterialCommunityIcons: ({ name }: { name: string }) => ReactActual.createElement(Text, null, name) };
});

jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: {
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f', gold: '#c9a13b',
      ink: '#2a2a22', muted: '#6b6860', danger: '#b42318',
    },
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif', mono: 'Mono' },
  }),
}));

const mockWorkspace = useBillingWorkspace as jest.Mock;
const mockSelectPlan = useSelectPlan as jest.Mock;
const mockCancel = useCancelSubscription as jest.Mock;
const mockApiPost = apiClient.post as jest.Mock;

const PLANS = [
  { name: 'Free', price: '0' },
  { name: 'Starter', price: '49', price_ghs: '49', annual_price_ghs: '490', features: ['500 items'] },
  { name: 'Pro', price: '149', price_ghs: '149', annual_price_ghs: '1490', features: ['Unlimited'] },
];

describe('Billing screen', () => {
  let selectMutate: jest.Mock;
  let cancelMutate: jest.Mock;

  beforeEach(() => {
    selectMutate = jest.fn();
    cancelMutate = jest.fn();
    mockSelectPlan.mockReturnValue({ mutate: selectMutate, isPending: false });
    mockCancel.mockReturnValue({ mutate: cancelMutate, isPending: false });
    mockApiPost.mockReset();
    (WebBrowser.openBrowserAsync as jest.Mock).mockClear();
    mockWorkspace.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: {
        plans: PLANS,
        subscription: { plan: 'Starter', status: 'active', billing_interval: 'monthly' },
        planUsage: undefined,
        transactions: [],
      },
    });
  });

  it('shows a loading spinner while billing data is being fetched', () => {
    mockWorkspace.mockReturnValue({ isLoading: true, isError: false, data: undefined, refetch: jest.fn() });
    const { queryByText } = render(<BillingScreen />);
    expect(queryByText('Plan & billing')).toBeNull();
  });

  it('shows a retryable error state on fetch failure', () => {
    mockWorkspace.mockReturnValue({ isLoading: false, isError: true, data: undefined, refetch: jest.fn() });
    const { getByText } = render(<BillingScreen />);
    expect(getByText('Could not load billing data.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('shows the current plan summary', () => {
    const { getByText } = render(<BillingScreen />);
    expect(getByText('Current plan')).toBeTruthy();
    expect(getByText('active')).toBeTruthy();
  });

  it('labels a plan below the current tier as Downgrade and above as Upgrade', () => {
    const { getByText } = render(<BillingScreen />);
    expect(getByText('Downgrade')).toBeTruthy(); // Free, below Starter
    expect(getByText('Upgrade')).toBeTruthy(); // Pro, above Starter
  });

  it('activates a free/no-payment plan change immediately without opening a browser', async () => {
    selectMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: (r: unknown) => void }) => onSuccess({}));
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<BillingScreen />);
    fireEvent.press(getByText('Downgrade'));

    await waitFor(() => {
      expect(selectMutate).toHaveBeenCalledWith({ tier: 'free', billing_interval: 'monthly' }, expect.anything());
    });
    expect(WebBrowser.openBrowserAsync).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Plan updated', 'Your plan has been changed.');
    alertSpy.mockRestore();
  });

  it('opens Paystack checkout and activates the plan after verified payment', async () => {
    selectMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: (r: unknown) => void }) =>
      onSuccess({ payment_url: 'https://paystack.test/pay/abc', provider_ref: 'ref-123' })
    );
    mockApiPost.mockResolvedValue({ data: { activated: true } });
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});

    const { getByText } = render(<BillingScreen />);
    fireEvent.press(getByText('Upgrade'));

    await waitFor(() => {
      expect(WebBrowser.openBrowserAsync).toHaveBeenCalledWith(
        'https://paystack.test/pay/abc',
        expect.objectContaining({ presentationStyle: 'FULL_SCREEN' })
      );
    });
    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith('/api/v1/billing/subscribe/verify', { provider_ref: 'ref-123' });
    });
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Plan activated!', "You're now on the pro plan.");
    });
    alertSpy.mockRestore();
  });

  it('shows Cancel subscription only for an active paid plan without a scheduled cancellation', () => {
    const { getByText } = render(<BillingScreen />);
    expect(getByText('Cancel subscription')).toBeTruthy();
  });

  it('does not show Cancel subscription for the free plan', () => {
    mockWorkspace.mockReturnValue({
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: { plans: PLANS, subscription: { plan: 'Free', status: 'active', billing_interval: 'monthly' }, transactions: [] },
    });
    const { queryByText } = render(<BillingScreen />);
    expect(queryByText('Cancel subscription')).toBeNull();
  });

  it('confirms and cancels the subscription', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(
      (_title: string, _msg: string, buttons: Array<{ text: string; onPress?: () => void }>) => {
        buttons.find((b) => b.text === 'Cancel subscription')?.onPress?.();
      }
    );
    const { getByText } = render(<BillingScreen />);
    fireEvent.press(getByText('Cancel subscription'));
    expect(cancelMutate).toHaveBeenCalledWith(undefined, expect.anything());
    alertSpy.mockRestore();
  });
});
