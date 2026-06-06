jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(),
}));

import { render } from '@testing-library/react-native';
import { SyncStatus } from '@/components/feedback/SyncStatus';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';

describe('SyncStatus', () => {
  beforeEach(() => {
    useUIStore.setState({ isOffline: false });
    useSyncStore.setState({ isSyncing: false, pendingCount: 0, lastSyncedAt: {}, lastSyncError: null });
  });

  it('shows synced when there is no offline queue', () => {
    const screen = render(<SyncStatus />);
    expect(screen.getByText('Synced')).toBeTruthy();
    expect(screen.getByText('Local data is aligned with the backend.')).toBeTruthy();
  });

  it('shows queued changes when pending records exist', () => {
    useSyncStore.setState({ pendingCount: 3 });
    const screen = render(<SyncStatus />);
    expect(screen.getByText('3 queued')).toBeTruthy();
  });

  it('shows offline copy when the device has no internet', () => {
    useUIStore.setState({ isOffline: true });
    const screen = render(<SyncStatus />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText('Changes are saved on this device and will sync when internet returns.')).toBeTruthy();
  });

  it('shows the last successful sync and retry copy after a failed sync', () => {
    useSyncStore.setState({
      pendingCount: 2,
      lastSyncedAt: { sales: Date.UTC(2026, 4, 28, 9, 30, 0) },
      lastSyncError: 'Network request failed',
    });

    const screen = render(<SyncStatus />);

    expect(screen.getByText('2 queued')).toBeTruthy();
    expect(screen.getByText(/Last synced/)).toBeTruthy();
    expect(screen.getByText(/Retrying when connection is stable/)).toBeTruthy();
  });
});
