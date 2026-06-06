import { Badge } from '@/components/ui/Badge';
import { Text } from '@/components/ui/Text';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';
import { useTheme } from '@/lib/theme';

export function SyncStatus() {
  const { colors, spacing } = useTheme();
  const isOffline = useUIStore((state) => state.isOffline);
  const isSyncing = useSyncStore((state) => state.isSyncing);
  const pendingCount = useSyncStore((state) => state.pendingCount);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const lastSyncError = useSyncStore((state) => state.lastSyncError);
  const lastSyncTs = Math.max(0, ...Object.values(lastSyncedAt));
  const lastSyncLabel =
    lastSyncTs > 0
      ? `Last synced ${new Date(lastSyncTs).toLocaleString('en-GH', {
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          month: 'short',
        })}. `
      : '';

  const label = isOffline
    ? 'Offline'
    : isSyncing
    ? 'Syncing'
    : pendingCount > 0
    ? `${pendingCount} queued`
    : 'Synced';
  const variant = isOffline ? 'offline' : pendingCount > 0 || isSyncing ? 'pending' : 'synced';

  return (
    <>
      <Badge label={label} variant={variant} />
      <Text style={{ color: colors.muted, marginTop: spacing.xs }}>
        {isOffline
          ? 'Changes are saved on this device and will sync when internet returns.'
          : lastSyncError
          ? `${lastSyncLabel}Retrying when connection is stable. Data is saved on this device.`
          : pendingCount > 0
          ? `${lastSyncLabel}Queued changes are waiting to sync with the backend.`
          : 'Local data is aligned with the backend.'}
      </Text>
    </>
  );
}
