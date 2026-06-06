jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) => (
      <View style={style}>{children}</View>
    ),
  };
});

const mockRefetch = jest.fn();
const mockMutate = jest.fn();

jest.mock('@/api/hooks/featureHooks', () => ({
  useCancelMerchantSettlement: () => ({ isPending: false, mutate: mockMutate }),
  useGenerateGhQR: () => ({ isPending: false, mutate: mockMutate, data: null }),
  usePaymentsWorkspace: () => ({
    data: {
      items: [
        {
          id: 'pay-pending',
          type: 'collection',
          provider: 'paystack',
          processor: 'paystack',
          channel: 'mobile_money',
          amount: '45.00',
          status: 'pending',
        },
      ],
      total: 0,
      reconciliation: {
        total: 1,
        limit: 50,
        offset: 0,
        summary: { unmatched: 1, suggested_match: 0, matched: 2, ignored: 0, refunded: 0 },
        items: [
          {
            id: 'pay-1',
            provider: 'mtn',
            amount: '30.00',
            phone: '+233244000000',
            external_ref: 'PS-123',
            status: 'success',
            match_state: 'unmatched',
          },
        ],
      },
      channelAnalytics: {
        grand_total: '30.00',
        items: [
          { processor: 'paystack', channel: 'mobile_money', provider_detail: 'mtn', count: 1, total: '30.00' },
        ],
      },
      settlementBalance: {
        business_id: 'biz-1',
        unsettled_balance: '27.00',
        total_settled: '0.00',
        settlement_threshold: '50.00',
        settlement_enabled: true,
        pending_settlement_count: 0,
        eligible_for_auto_settlement: false,
        fee_rate_percent: 10,
        min_settlement_ghs: '10.00',
        auto_approve_ceiling_ghs: '5000.00',
      },
      settlementLedger: {
        total: 1,
        items: [
          {
            id: 'ledger-1',
            type: 'credit',
            amount: '30.00',
            balance_after: '30.00',
            description: 'Payment received',
            created_at: '2026-06-05T08:00:00Z',
          },
        ],
      },
      settlements: { total: 0, items: [] },
    },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
  }),
  useRequestMerchantSettlement: () => ({ isPending: false, mutate: mockMutate }),
}));

jest.mock('@/api/hooks/sessionHooks', () => ({
  useAddMomoAccount: () => ({ isPending: false, mutate: mockMutate }),
  useProvisionDedicatedAccount: () => ({ isPending: false, mutate: mockMutate }),
  useVerifyMomoAccount: () => ({ isPending: false, mutate: mockMutate }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';
import PaymentsScreen from '../../app/owner/payments-history';
import { useAuthStore } from '@/store/auth';

describe('payments screen wallet UX', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      business: { id: 'biz-1', name: 'Ama Shop', type: 'shop' },
      momoAccounts: [
        {
          id: 'wallet-1',
          business_id: 'biz-1',
          provider: 'mtn',
          phone: '+233244000000',
          account_name: 'Ama Mensah',
          is_primary: true,
          is_verified: true,
          status: 'verified',
        },
      ],
    } as any);
  });

  it('separates platform-held wallet balance, online channels, and reconciliation review', () => {
    const screen = render(<PaymentsScreen />);

    expect(screen.getByText('Held by SMEFlow')).toBeTruthy();
    expect(screen.getByText('Available to withdraw from successful online collections')).toBeTruthy();
    expect(screen.getByText('Provider pending')).toBeTruthy();
    expect(screen.getByText('GH₵ 45.00')).toBeTruthy();
    expect(screen.getByText('Manual sales not held')).toBeTruthy();
    expect(screen.getByText('Online payments by channel')).toBeTruthy();
    expect(screen.getByText('Successful platform collections before fees. Cash/manual sales stay in sales reports.')).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText('Linked')).toBeTruthy();
    expect(screen.getByText('Review payments')).toBeTruthy();
  });
});
