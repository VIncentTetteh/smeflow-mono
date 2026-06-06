import { create } from 'zustand';

interface SyncState {
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt: { [table: string]: number }; // table → epoch ms
  lastSyncError: string | null;
  setPendingCount: (n: number) => void;
  setIsSyncing: (v: boolean) => void;
  setLastSyncedAt: (table: string, ts: number) => void;
  setLastSyncError: (message: string | null) => void;
}

export interface SyncStatusSnapshot {
  hasFailedSync: boolean;
  isSyncing: boolean;
  lastSuccessfulSyncAt: string | null;
  lastSyncError: string | null;
  pendingCount: number;
}

export const useSyncStore = create<SyncState>()((set) => ({
  pendingCount: 0,
  isSyncing: false,
  lastSyncedAt: {},
  lastSyncError: null,
  setPendingCount: (n) => set({ pendingCount: n }),
  setIsSyncing: (v) => set({ isSyncing: v }),
  setLastSyncedAt: (table, ts) =>
    set((s) => ({ lastSyncedAt: { ...s.lastSyncedAt, [table]: ts } })),
  setLastSyncError: (message) => set({ lastSyncError: message }),
}));

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
  const { isSyncing, lastSyncedAt, lastSyncError, pendingCount } = useSyncStore.getState();
  const lastSyncTs = Math.max(0, ...Object.values(lastSyncedAt));

  return {
    hasFailedSync: !!lastSyncError,
    isSyncing,
    lastSuccessfulSyncAt: lastSyncTs > 0 ? new Date(lastSyncTs).toISOString() : null,
    lastSyncError,
    pendingCount,
  };
}
