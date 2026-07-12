jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';
import CreditScreen from '../../app/owner/credit';
import {
  useActiveLenders,
  useConfirmLoan,
  useCreditRequests,
  useCreditScore,
  useLoan,
  useLoanSchedule,
  useRequestLoan,
  useResendLoanConfirmation,
} from '@/api/hooks/featureHooks';
import { usePlanGate } from '@/api/hooks/planGate';

jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
  fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
}));

jest.mock('@/api/hooks/featureHooks', () => ({
  useCreditScore: jest.fn(),
  useCreditRequests: jest.fn(),
  useActiveLenders: jest.fn(),
  useRequestLoan: jest.fn(),
  useLoan: jest.fn(),
  useLoanSchedule: jest.fn(),
  useConfirmLoan: jest.fn(),
  useResendLoanConfirmation: jest.fn(),
}));

jest.mock('@/api/hooks/planGate', () => ({
  usePlanGate: jest.fn(),
}));

jest.mock('@/components/ui/PlanGatedScreen', () => {
  const ReactActual = require('react');
  return { PlanGatedScreen: ({ children }: { children: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});

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
  }),
}));

const mockUsePlanGate = usePlanGate as jest.Mock;
const mockUseCreditScore = useCreditScore as jest.Mock;
const mockUseCreditRequests = useCreditRequests as jest.Mock;
const mockUseActiveLenders = useActiveLenders as jest.Mock;
const mockUseRequestLoan = useRequestLoan as jest.Mock;
const mockUseLoan = useLoan as jest.Mock;
const mockUseLoanSchedule = useLoanSchedule as jest.Mock;
const mockUseConfirmLoan = useConfirmLoan as jest.Mock;
const mockUseResendLoanConfirmation = useResendLoanConfirmation as jest.Mock;

describe('Credit & Loans screen', () => {
  beforeEach(() => {
    mockUsePlanGate.mockReturnValue({ allowed: true, loading: false });
    mockUseCreditScore.mockReturnValue({ data: { score: 72, band: 'B', factors: {} }, isLoading: false });
    mockUseCreditRequests.mockReturnValue({ data: [] });
    mockUseActiveLenders.mockReturnValue({ data: [], isError: false });
    mockUseRequestLoan.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseLoan.mockReturnValue({ data: undefined });
    mockUseLoanSchedule.mockReturnValue({ data: [] });
    mockUseConfirmLoan.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockUseResendLoanConfirmation.mockReturnValue({ mutate: jest.fn(), isPending: false });
  });

  it('shows a loading spinner while the plan gate or score is resolving', () => {
    mockUsePlanGate.mockReturnValue({ allowed: true, loading: true });
    const { queryByText } = render(<CreditScreen />);
    expect(queryByText('Credit & Loans')).toBeNull();
  });

  it('renders the SMEflow score and band once loaded', async () => {
    const { getByText } = render(<CreditScreen />);
    await waitFor(() => expect(getByText('72')).toBeTruthy());
    expect(getByText('Credit & Loans')).toBeTruthy();
  });

  it('shows existing loan requests with amount and status', async () => {
    mockUseCreditRequests.mockReturnValue({
      data: [{ id: 'loan-1', amount_requested: '5000', term_days: 90, status: 'pending_partner' }],
    });
    const { getByText } = render(<CreditScreen />);
    await waitFor(() => expect(getByText('GH₵ 5,000')).toBeTruthy());
    expect(getByText('90-day term · tap for details')).toBeTruthy();
    expect(getByText('Awaiting Lender')).toBeTruthy();
  });

  it('shows the offline empty state for loan partners and disables applying', async () => {
    jest.spyOn(require('@react-native-community/netinfo'), 'fetch').mockResolvedValue({
      isConnected: false,
      isInternetReachable: false,
    });
    const { getByText } = render(<CreditScreen />);
    await waitFor(() => expect(getByText('Loan applications need internet')).toBeTruthy());
  });
});
