jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({ set: jest.fn(), getString: jest.fn(), delete: jest.fn() })),
}));

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import NotificationsScreen from '../../app/owner/notifications';
import {
  useDismissMerchantAlert,
  useMarkMerchantAlertRead,
  useMerchantAlerts,
  useNotificationsWorkspace,
  useRetryNotificationEvent,
  useUpdateNotificationPreferences,
} from '@/api/hooks/featureHooks';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/api/hooks/featureHooks', () => ({
  useMerchantAlerts: jest.fn(),
  useMarkMerchantAlertRead: jest.fn(),
  useDismissMerchantAlert: jest.fn(),
  useUpdateNotificationPreferences: jest.fn(),
  useNotificationsWorkspace: jest.fn(),
  useRetryNotificationEvent: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{name}</Text> };
});
jest.mock('@/lib/theme', () => ({
  useTheme: () => ({
    colors: { bg: '#faf8f3', surface: '#fff', border: '#e8e5de', brand: '#1f6a4f', ink: '#2a2a22', muted: '#6b6860', danger: '#b42318' },
    fonts: { body: 'Inter', bodySemiBold: 'InterSemiBold', displaySemiBold: 'Serif' },
  }),
}));

const mockAlerts = useMerchantAlerts as jest.Mock;
const mockRead = useMarkMerchantAlertRead as jest.Mock;
const mockDismiss = useDismissMerchantAlert as jest.Mock;
const mockPrefs = useUpdateNotificationPreferences as jest.Mock;
const mockWorkspace = useNotificationsWorkspace as jest.Mock;
const mockRetry = useRetryNotificationEvent as jest.Mock;

describe('professional merchant notifications inbox', () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRead.mockReturnValue({ mutate: jest.fn() });
    mockDismiss.mockReturnValue({ mutate: jest.fn() });
    mockPrefs.mockReturnValue({ mutate: jest.fn() });
    mockRetry.mockReturnValue({ mutate: jest.fn(), isPending: false });
    mockWorkspace.mockReturnValue({
      isLoading: false,
      data: {
        preferences: {
          id: 'pref-1',
          whatsapp_enabled: true,
          sms_enabled: true,
          push_enabled: true,
          event_prefs: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        events: [{
          id: 'event-1',
          event_type: 'invoice.sent',
          channel: 'whatsapp',
          phone: '+233244000000',
          message: 'Invoice sent to customer',
          status: 'sent',
          provider_response: null,
          retryable: false,
          created_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
        }],
      },
    });
    mockAlerts.mockImplementation((view: string) => ({
      isLoading: false,
      data: view === 'attention'
        ? {
            unread_count: 1,
            items: [{
              id: 'alert-1',
              alert_type: 'payment_failure',
              severity: 'critical',
              title: 'Payment failed',
              message: 'Retry or collect another way.',
              status: 'needs_attention',
              resource_type: 'sale',
              resource_id: 'sale-1',
              action_path: '/owner/sales?sale_id=sale-1',
              action_label: 'Open sale',
              occurrence_count: 2,
              read_at: null,
              resolved_at: null,
              dismissed_at: null,
              dismissal_reason: null,
              latest_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              provider_error: null,
            }],
          }
        : { unread_count: 0, items: [] },
    }));
  });

  it('shows actionable alerts and never renders raw delivery errors or autopilot controls', () => {
    const { getByText, queryByText } = render(<NotificationsScreen />);
    expect(getByText('Needs attention')).toBeTruthy();
    expect(getByText('Payment failed')).toBeTruthy();
    expect(getByText('Open sale')).toBeTruthy();
    expect(queryByText('WhatsApp Autopilot')).toBeNull();
    expect(queryByText('Delivery history')).toBeNull();
    expect(queryByText('provider down')).toBeNull();
  });

  it('marks an alert read and opens its related record', () => {
    const mutate = jest.fn();
    mockRead.mockReturnValue({ mutate });
    const { getByText } = render(<NotificationsScreen />);
    fireEvent.press(getByText('Open sale'));
    expect(mutate).toHaveBeenCalledWith('alert-1');
    expect(mockPush).toHaveBeenCalledWith('/owner/sales?sale_id=sale-1');
  });

  it('opens separate customer delivery history', () => {
    const { getByText } = render(<NotificationsScreen />);
    fireEvent.press(getByText('Customer message history'));
    expect(mockPush).toHaveBeenCalledWith('/owner/message-deliveries');
  });

  it('shows notification event activity separately from actionable alerts', () => {
    const { getByText } = render(<NotificationsScreen />);
    fireEvent.press(getByText('Activity'));
    expect(getByText('Invoice sent to customer')).toBeTruthy();
    expect(getByText('invoice.sent')).toBeTruthy();
  });
});
