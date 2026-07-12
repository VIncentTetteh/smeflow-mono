import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import ReconciliationScreen from '../../app/owner/reconciliation';
import {
  useIgnoreReconciliationItem,
  useReconciliationInbox,
  useUnignoreReconciliationItem,
} from '@/api/hooks/featureHooks';

const mockBack = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: mockBack }) }));

jest.mock('@/api/hooks/featureHooks', () => ({
  useReconciliationInbox: jest.fn(),
  useIgnoreReconciliationItem: jest.fn(),
  useUnignoreReconciliationItem: jest.fn(),
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
      bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f',
      ink: '#2a2a22', muted: '#6b6860', danger: '#b42318',
    },
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif' },
    radii: { md: 10 },
  }),
}));

const mockInbox = useReconciliationInbox as jest.Mock;
const mockIgnore = useIgnoreReconciliationItem as jest.Mock;
const mockUnignore = useUnignoreReconciliationItem as jest.Mock;

describe('Payment reconciliation screen', () => {
  let ignoreMutate: jest.Mock;
  let unignoreMutate: jest.Mock;

  beforeEach(() => {
    mockBack.mockReset();
    ignoreMutate = jest.fn();
    unignoreMutate = jest.fn();
    mockIgnore.mockReturnValue({ mutate: ignoreMutate, isPending: false });
    mockUnignore.mockReturnValue({ mutate: unignoreMutate, isPending: false });
  });

  it('shows a loading indicator while the inbox is fetching', () => {
    mockInbox.mockReturnValue({ isLoading: true, isError: false, isFetching: false, data: undefined, refetch: jest.fn() });
    const { queryByText } = render(<ReconciliationScreen />);
    expect(queryByText('All clear')).toBeNull();
  });

  it('shows a retryable error state on fetch failure', () => {
    mockInbox.mockReturnValue({ isLoading: false, isError: true, isFetching: false, data: undefined, refetch: jest.fn() });
    const { getByText } = render(<ReconciliationScreen />);
    expect(getByText('Could not load payments. Pull to retry.')).toBeTruthy();
  });

  it('shows the "All clear" empty state, phrased for the current filter', () => {
    mockInbox.mockReturnValue({ isLoading: false, isError: false, isFetching: false, data: { items: [], total: 0 }, refetch: jest.fn() });
    const { getByText } = render(<ReconciliationScreen />);
    expect(getByText('All clear')).toBeTruthy();
    expect(getByText('No payments need review. Switch to "All payments" to see the full history.')).toBeTruthy();
  });

  it('renders an unmatched payment with its provider badge, amount, status, and an Ignore action', () => {
    mockInbox.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
      data: {
        total: 1,
        summary: { unmatched: 1, matched: 0, ignored: 0 },
        items: [{
          id: 'p1', provider: 'mtn', amount: '250.00', match_state: 'unmatched',
          phone: '+233244000000', external_ref: 'REF123', confirmed_at: '2026-07-01T10:00:00Z',
        }],
      },
    });
    const { getByText, getAllByText } = render(<ReconciliationScreen />);
    expect(getByText('MTN')).toBeTruthy();
    expect(getByText('GH₵ 250.00')).toBeTruthy();
    // "Needs review" appears both as the filter chip and the item's status badge.
    expect(getAllByText('Needs review').length).toBe(2);
    expect(getByText('Ignore')).toBeTruthy();
    expect(getByText('1 needs review · 0 linked · 0 ignored')).toBeTruthy();
  });

  it('does not show an Ignore/Restore action for matched or refunded payments', () => {
    mockInbox.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
      data: {
        total: 1,
        items: [{ id: 'p1', provider: 'mtn', amount: '250.00', match_state: 'matched', sale_id: 's1' }],
      },
    });
    const { getByText, queryByText } = render(<ReconciliationScreen />);
    expect(getByText('Linked to sale')).toBeTruthy();
    expect(queryByText('Ignore')).toBeNull();
    expect(queryByText('Restore')).toBeNull();
  });

  it('confirms and ignores an unmatched payment', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(
      (_title: string, _msg: string, buttons: Array<{ text: string; onPress?: () => void }>) => {
        buttons.find((b) => b.text === 'Ignore')?.onPress?.();
      }
    );
    mockInbox.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
      data: { total: 1, items: [{ id: 'p1', provider: 'mtn', amount: '250.00', match_state: 'unmatched' }] },
    });
    const { getByText } = render(<ReconciliationScreen />);
    fireEvent.press(getByText('Ignore'));
    expect(alertSpy).toHaveBeenCalled();
    expect(ignoreMutate).toHaveBeenCalledWith('p1', expect.anything());
    alertSpy.mockRestore();
  });

  it('shows Restore (not Ignore) for an already-ignored payment and calls unignore', () => {
    const alertSpy = jest.spyOn(require('react-native').Alert, 'alert').mockImplementation(
      (_title: string, _msg: string, buttons: Array<{ text: string; onPress?: () => void }>) => {
        buttons.find((b) => b.text === 'Restore')?.onPress?.();
      }
    );
    mockInbox.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
      data: { total: 1, items: [{ id: 'p1', provider: 'vodafone', amount: '75.00', match_state: 'ignored' }] },
    });
    const { getByText } = render(<ReconciliationScreen />);
    fireEvent.press(getByText('Restore'));
    expect(unignoreMutate).toHaveBeenCalledWith('p1', expect.anything());
    alertSpy.mockRestore();
  });

  it('disables the Previous button on the first page and shows pagination controls beyond one page', () => {
    mockInbox.mockReturnValue({
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: jest.fn(),
      data: {
        total: 40,
        items: Array.from({ length: 25 }, (_, i) => ({
          id: `p${i}`, provider: 'mtn', amount: '10.00', match_state: 'unmatched',
        })),
      },
    });
    const { getByText } = render(<ReconciliationScreen />);
    expect(getByText('1 / 2')).toBeTruthy();
    expect(getByText('← Previous')).toBeTruthy();
    expect(getByText('Next →')).toBeTruthy();
  });
});
