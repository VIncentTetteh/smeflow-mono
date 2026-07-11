import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { SyncStatus } from '@/components/feedback/SyncStatus';
import { Text } from '@/components/ui/Text';
import { syncNow } from '@/db/sync/service';
import { useTheme } from '@/lib/theme';
import { useSyncStore } from '@/store/sync';
import { useUIStore } from '@/store/ui';

function formatLastSync(values: Record<string, number>) {
  const lastSyncTs = Math.max(0, ...Object.values(values));
  if (lastSyncTs <= 0) return 'No successful sync yet';
  return new Date(lastSyncTs).toLocaleString('en-GH', {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
  });
}

export default function SyncScreen() {
  const { colors, fonts } = useTheme();
  const isOffline = useUIStore((state) => state.isOffline);
  const isSyncing = useSyncStore((state) => state.isSyncing);
  const pendingCount = useSyncStore((state) => state.pendingCount);
  const lastSyncedAt = useSyncStore((state) => state.lastSyncedAt);
  const lastSyncError = useSyncStore((state) => state.lastSyncError);
  const [manualSyncing, setManualSyncing] = useState(false);

  async function handleSyncNow() {
    setManualSyncing(true);
    try {
      await syncNow();
    } catch {
      // syncNow updates lastSyncError in the sync store; error is displayed in the UI below
    } finally {
      setManualSyncing(false);
    }
  }

  const syncing = isSyncing || manualSyncing;
  const rows = [
    { label: 'Queued records', value: String(pendingCount), icon: 'tray-arrow-up' },
    { label: 'Connection', value: isOffline ? 'Offline' : 'Online', icon: isOffline ? 'wifi-off' : 'wifi' },
    { label: 'Last synced', value: formatLastSync(lastSyncedAt), icon: 'clock-outline' },
  ];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View
        style={{
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>
          Offline & sync
        </Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>
          Local sales, stock, and customer changes stay on this device until the backend confirms them.
        </Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={() => void handleSyncNow()} tintColor={colors.brand} />}
      >
        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <SyncStatus />
            </View>
            <TouchableOpacity
              onPress={() => void handleSyncNow()}
              disabled={syncing}
              style={{
                minHeight: 38,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: colors.brand,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                opacity: syncing ? 0.6 : 1,
              }}
            >
              {syncing ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <MaterialCommunityIcons name="sync" size={15} color="#fff" />
              )}
              <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                Sync now
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
          {rows.map((row, index) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                paddingHorizontal: 12,
                paddingVertical: 12,
                borderBottomWidth: index < rows.length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
              }}
            >
              <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name={row.icon as never} size={15} color={colors.muted} />
              </View>
              <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                {row.label}
              </Text>
              <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'right', maxWidth: 180 }}>
                {row.value}
              </Text>
            </View>
          ))}
        </View>

        {lastSyncError ? (
          <View style={{ backgroundColor: `${colors.danger}10`, borderWidth: 1, borderColor: `${colors.danger}40`, borderRadius: 14, padding: 12 }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.danger }}>
              Last sync error
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginTop: 3, lineHeight: 17 }}>
              {lastSyncError}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
