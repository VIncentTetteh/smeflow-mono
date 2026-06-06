import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import type { Database } from '@nozbe/watermelondb';
import { database as defaultDatabase } from '@/db';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { pullChanges } from './pull';
import { countPendingRecords, pushChanges } from './push';
import type { SyncResult } from './types';

let syncInFlight: Promise<SyncResult> | null = null;
let intervalId: ReturnType<typeof setInterval> | null = null;
let unsubscribeNetInfo: (() => void) | null = null;
let unsubscribeAppState: { remove: () => void } | null = null;

function mergeErrors(
  ...groups: Array<Array<{ table: SyncResult['errors'][number]['table']; message: string }>>
) {
  return groups.flat();
}

export async function syncNow(database: Database = defaultDatabase): Promise<SyncResult> {
  if (syncInFlight) {
    return syncInFlight;
  }

  syncInFlight = (async () => {
    const syncStore = useSyncStore.getState();
    syncStore.setIsSyncing(true);

    try {
      const pushResult = await pushChanges(database);
      const pullResult = await pullChanges(database);
      const pendingCount = await countPendingRecords(database);
      const errors = mergeErrors(pushResult.errors, pullResult.errors);
      const syncState = useSyncStore.getState();
      const syncedAt = Date.now();

      syncState.setPendingCount(pendingCount);
      for (const table of new Set([
        ...Object.keys(pushResult.pushed),
        ...Object.keys(pullResult.pulled),
      ])) {
        syncState.setLastSyncedAt(table, syncedAt);
      }

      if (errors.length > 0) {
        syncState.setLastSyncError(errors.map((error) => error.message).join('; '));
        trackEvent(MOBILE_ANALYTICS_EVENTS.SYNC_FAILED, {
          errorCount: errors.length,
          pendingCount,
          tables: errors.map((error) => error.table).join(','),
        });
      } else {
        syncState.setLastSyncError(null);
      }

      return {
        pulled: pullResult.pulled,
        pushed: pushResult.pushed,
        errors,
      };
    } finally {
      useSyncStore.getState().setIsSyncing(false);
      syncInFlight = null;
    }
  })();

  return syncInFlight;
}

export async function refreshPendingCount(database: Database = defaultDatabase) {
  const pendingCount = await countPendingRecords(database);
  useSyncStore.getState().setPendingCount(pendingCount);
  return pendingCount;
}

export function startSyncService(database: Database = defaultDatabase) {
  if (unsubscribeNetInfo || unsubscribeAppState || intervalId) {
    return stopSyncService;
  }

  unsubscribeNetInfo = NetInfo.addEventListener((state) => {
    const isOffline = !(state.isConnected && state.isInternetReachable !== false);
    useUIStore.getState().setOffline(isOffline);
    if (!isOffline) {
      void syncNow(database);
    }
  });

  unsubscribeAppState = AppState.addEventListener('change', (state) => {
    if (state === 'active' && !useUIStore.getState().isOffline) {
      void syncNow(database);
    }
  });

  intervalId = setInterval(() => {
    if (!useUIStore.getState().isOffline) {
      void syncNow(database);
    }
  }, 5 * 60 * 1000);

  void refreshPendingCount(database);
  return stopSyncService;
}

export function stopSyncService() {
  unsubscribeNetInfo?.();
  unsubscribeNetInfo = null;
  unsubscribeAppState?.remove();
  unsubscribeAppState = null;

  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
