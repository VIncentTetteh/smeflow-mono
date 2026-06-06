jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: jest.fn(),
  }),
}));

jest.mock('@/lib/deviceFeatures', () => ({
  biometricUnlock: jest.fn(),
  isBiometricAvailable: jest.fn().mockResolvedValue(false),
}));

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../../app/owner/settings';
import { useAuthStore } from '@/store/auth';

describe('settings navigation', () => {
  beforeEach(() => {
    mockPush.mockClear();
    useAuthStore.setState({
      user: { id: 'user-1', name: 'Ama Mensah', phone: '+233240000000' },
      business: { id: 'biz-1', name: 'Ama Shop', type: 'shop' },
      members: [
        { id: 'member-1', user_id: 'user-1', role: 'owner', is_active: true, user_name: 'Ama Mensah', user_phone: '+233240000000' },
      ],
      momoAccounts: [],
      biometricEnabled: false,
    });
  });

  it('opens real team and sync workspaces from settings', async () => {
    const screen = render(<SettingsScreen />);

    await waitFor(() => expect(screen.getByText('Team & roles')).toBeTruthy());
    expect(screen.getByText('VAT, TIN and filing settings')).toBeTruthy();

    fireEvent.press(screen.getByText('Team & roles'));
    expect(mockPush).toHaveBeenCalledWith('/owner/team');

    fireEvent.press(screen.getByText('Offline & sync'));
    expect(mockPush).toHaveBeenCalledWith('/owner/sync');
  });
});
