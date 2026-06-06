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

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: jest.fn(),
  }),
}));

jest.mock('@/api/hooks/sessionHooks', () => ({
  useSwitchBusiness: () => ({ isPending: false, mutate: jest.fn() }),
}));

import React from 'react';
import { render } from '@testing-library/react-native';
import MoreScreen from '../../app/owner/more';
import { useAuthStore } from '@/store/auth';

describe('more screen navigation copy', () => {
  beforeEach(() => {
    useAuthStore.setState({
      business: { id: 'biz-1', name: 'Ama Shop', type: 'shop', subscription: 'free' },
      businesses: [
        {
          business_id: 'biz-1',
          business_name: 'Ama Shop',
          role: 'owner',
          subscription: 'free',
          business_type: 'shop',
        },
      ],
    } as any);
  });

  it('uses durable finance and account menu subtitles', () => {
    const screen = render(<MoreScreen />);

    expect(screen.getByText('Revenue, P&L, cash flow, customers')).toBeTruthy();
    expect(screen.getByText('Alerts and delivery settings')).toBeTruthy();
    expect(screen.getByText('Invite traders and track rewards')).toBeTruthy();
  });
});
