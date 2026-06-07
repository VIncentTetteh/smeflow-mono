jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

const mockInviteMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockDeactivateMutate = jest.fn();

jest.mock('@/api/hooks/sessionHooks', () => ({
  useInviteBusinessMember: () => ({ isPending: false, mutate: mockInviteMutate }),
  useUpdateBusinessMember: () => ({ isPending: false, mutate: mockUpdateMutate }),
  useDeactivateBusinessMember: () => ({ isPending: false, mutate: mockDeactivateMutate }),
}));

// PlanGatedScreen uses useQuery internally — mock it to always render children
jest.mock('@/components/ui/PlanGatedScreen', () => {
  const React = require('react');
  return {
    PlanGatedScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import TeamScreen from '../../app/owner/team';
import { useAuthStore } from '@/store/auth';

describe('team screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAuthStore.setState({
      role: 'owner',
      members: [
        { id: 'owner-1', user_id: 'user-1', role: 'owner', is_active: true, user_name: 'Ama Owner', user_phone: '+233240000001' },
        { id: 'staff-1', user_id: 'user-2', role: 'staff', is_active: true, user_name: 'Kofi Staff', user_phone: '+233240000002' },
      ],
    });
  });

  it('lists members and can invite a staff member', () => {
    const screen = render(<TeamScreen />);

    expect(screen.getByText('Team & roles')).toBeTruthy();
    expect(screen.getByText('Ama Owner')).toBeTruthy();
    expect(screen.getByText('Kofi Staff')).toBeTruthy();
    expect(screen.queryByText('agent', { exact: false })).toBeNull();

    fireEvent.changeText(screen.getByPlaceholderText('024 000 0000'), '0244000003');
    fireEvent.press(screen.getByText('Invite'));

    expect(mockInviteMutate).toHaveBeenCalledWith(
      { phone: '0244000003', role: 'staff' },
      expect.any(Object)
    );
  });

  it('lets owners deactivate non-owner members', () => {
    const screen = render(<TeamScreen />);

    fireEvent.press(screen.getByText('Deactivate'));

    expect(mockDeactivateMutate).toHaveBeenCalledWith('staff-1', expect.any(Object));
  });
});
