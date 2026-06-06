jest.mock('react-native-mmkv', () => ({
  MMKV: jest.fn().mockImplementation(() => ({
    set: jest.fn(),
    getString: jest.fn(),
    delete: jest.fn(),
  })),
}));

jest.mock('@/db/sync/service', () => ({
  syncNow: jest.fn().mockResolvedValue({ pulled: {}, pushed: {}, errors: [] }),
}));

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => <Text>{name}</Text>,
  };
});

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import SyncScreen from '../../app/owner/sync';
import { syncNow } from '@/db/sync/service';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';

describe('sync screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useUIStore.setState({ isOffline: false });
    useSyncStore.setState({
      isSyncing: false,
      lastSyncedAt: { sales: Date.UTC(2026, 4, 28, 9, 30, 0) },
      pendingCount: 2,
      lastSyncError: 'Network request failed',
    });
  });

  it('shows sync health details and lets support trigger sync now', async () => {
    const screen = render(<SyncScreen />);

    expect(screen.getByText('Offline & sync')).toBeTruthy();
    expect(screen.getByText('2 queued')).toBeTruthy();
    expect(screen.getAllByText(/Last synced/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Network request failed/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByText('Sync now'));
    });

    expect(syncNow).toHaveBeenCalledTimes(1);
  });
});
