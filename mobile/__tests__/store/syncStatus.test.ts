import { getSyncStatusSnapshot, useSyncStore } from '@/store/sync';

describe('sync status snapshot', () => {
  beforeEach(() => {
    useSyncStore.setState({
      isSyncing: false,
      lastSyncedAt: {},
      pendingCount: 0,
      lastSyncError: null,
    });
  });

  it('returns a mobile-safe status contract for UI and support', () => {
    useSyncStore.setState({
      isSyncing: true,
      lastSyncedAt: { sales: 1760000000000, items: 1760000002000 },
      pendingCount: 3,
    });

    expect(getSyncStatusSnapshot()).toEqual({
      isSyncing: true,
      lastSuccessfulSyncAt: '2025-10-09T08:53:22.000Z',
      pendingCount: 3,
      lastSyncError: null,
      hasFailedSync: false,
    });
  });

  it('includes failed sync state for support and trust messaging', () => {
    useSyncStore.setState({
      lastSyncError: 'Network request failed',
      pendingCount: 2,
    });

    expect(getSyncStatusSnapshot()).toMatchObject({
      pendingCount: 2,
      lastSyncError: 'Network request failed',
      hasFailedSync: true,
    });
  });
});
