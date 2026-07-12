jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import AgentScreen from '../../app/agent/index';
import {
  useAgentTraders,
  useAgentWalletWorkspace,
  useAgentWorkspace,
  useWithdrawAgentWallet,
} from '@/api/hooks/featureHooks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

jest.mock('@/api/hooks/featureHooks', () => ({
  useAgentWorkspace: jest.fn(),
  useAgentTraders: jest.fn(),
  useAgentWalletWorkspace: jest.fn(),
  useWithdrawAgentWallet: jest.fn(),
}));

jest.mock('@/store/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) => selector({ user: { name: 'Kojo Agent', phone: '+233240000000' } }),
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
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif' },
    spacing: { sm: 8, md: 16, lg: 24 },
  }),
}));

const mockWorkspace = useAgentWorkspace as jest.Mock;
const mockTraders = useAgentTraders as jest.Mock;
const mockWalletWorkspace = useAgentWalletWorkspace as jest.Mock;
const mockWithdraw = useWithdrawAgentWallet as jest.Mock;

function baseWallet(overrides: Record<string, unknown> = {}) {
  return {
    available_balance: '150.00',
    pending_balance: '20.00',
    total_paid_out: '900.00',
    next_payout_date: '2026-07-17',
    eligible_for_payout: true,
    payout_threshold: '50.00',
    ...overrides,
  };
}

describe('Agent wallet screen', () => {
  let withdrawMutate: jest.Mock;

  beforeEach(() => {
    mockPush.mockReset();
    withdrawMutate = jest.fn();
    mockWorkspace.mockReturnValue({
      isLoading: false,
      data: { name: 'Kojo Agent', completed: 3, target: 10, period_commission: 45, is_active: true, active_traders: 1 },
    });
    mockTraders.mockReturnValue({ isLoading: false, data: [] });
    mockWalletWorkspace.mockReturnValue({ isLoading: false, data: { wallet: baseWallet() } });
    mockWithdraw.mockReturnValue({ mutate: withdrawMutate, isPending: false });
  });

  it('shows skeletons while workspace or wallet data is loading', () => {
    mockWalletWorkspace.mockReturnValue({ isLoading: true, data: undefined });
    const { queryByText } = render(<AgentScreen />);
    expect(queryByText('GH₵ 150.00')).toBeNull();
  });

  it('displays the available balance and disables Withdraw when not eligible for payout', () => {
    mockWalletWorkspace.mockReturnValue({
      isLoading: false,
      data: { wallet: baseWallet({ eligible_for_payout: false, available_balance: '10.00', payout_threshold: '50.00' }) },
    });
    const { getByText, queryByText } = render(<AgentScreen />);
    expect(getByText('GH₵ 10.00')).toBeTruthy();
    expect(getByText('Min: GH₵ 50.00')).toBeTruthy();
    // Below payout threshold: pressing Withdraw must not open the modal.
    fireEvent.press(getByText('Withdraw'));
    expect(queryByText('Withdraw funds')).toBeNull();
  });

  it('pre-fills the withdraw modal with the current available balance', () => {
    const { getByText, getByPlaceholderText } = render(<AgentScreen />);
    fireEvent.press(getByText('Withdraw'));
    expect(getByPlaceholderText('0.00').props.value).toBe('150.00');
  });

  it('rejects a withdrawal amount greater than the available balance', () => {
    const { getByText, getByPlaceholderText, getAllByText } = render(<AgentScreen />);
    fireEvent.press(getByText('Withdraw'));
    fireEvent.changeText(getByPlaceholderText('0.00'), '200.00');
    fireEvent.press(getAllByText('Withdraw')[1]);
    expect(withdrawMutate).not.toHaveBeenCalled();
  });

  it('submits a valid withdrawal and shows a success alert', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    withdrawMutate.mockImplementation((_vars, { onSuccess }: { onSuccess: () => void }) => onSuccess());

    const { getByText, getByPlaceholderText, getAllByText } = render(<AgentScreen />);
    fireEvent.press(getByText('Withdraw'));
    fireEvent.changeText(getByPlaceholderText('0.00'), '100.00');
    fireEvent.press(getAllByText('Withdraw')[1]);

    await waitFor(() => {
      expect(withdrawMutate).toHaveBeenCalledWith({ amount: 100 }, expect.anything());
    });
    expect(alertSpy).toHaveBeenCalledWith('Withdrawal initiated', expect.any(String));
    alertSpy.mockRestore();
  });

  it('shows an error alert when the withdrawal request fails', async () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(() => {});
    withdrawMutate.mockImplementation((_vars, { onError }: { onError: (e: Error) => void }) =>
      onError(new Error('MoMo provider unreachable'))
    );

    const { getByText, getByPlaceholderText, getAllByText } = render(<AgentScreen />);
    fireEvent.press(getByText('Withdraw'));
    fireEvent.changeText(getByPlaceholderText('0.00'), '50.00');
    fireEvent.press(getAllByText('Withdraw')[1]);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Withdrawal failed', 'MoMo provider unreachable');
    });
    alertSpy.mockRestore();
  });

  it('shows the empty pipeline state when there are no traders', () => {
    const { getByText } = render(<AgentScreen />);
    expect(getByText('No traders in your pipeline yet.\nStart by onboarding a new trader.')).toBeTruthy();
  });

  it('navigates to the pipeline screen with the trader highlighted when a row is tapped', () => {
    mockTraders.mockReturnValue({
      isLoading: false,
      data: [{ id: 't1', business_id: 'biz-1', business_name: 'Adwoa Store', name: 'Adwoa', kyc_status: 'pending' }],
    });
    const { getByText } = render(<AgentScreen />);
    fireEvent.press(getByText('Adwoa Store'));
    expect(mockPush).toHaveBeenCalledWith('/agent/pipeline?highlight=biz-1');
  });
});
