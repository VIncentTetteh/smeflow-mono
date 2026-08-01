import { ActivityIndicator, Alert, ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import {
  useDismissMerchantAlert,
  useMarkMerchantAlertRead,
  useMerchantAlerts,
  useNotificationsWorkspace,
  useRetryNotificationEvent,
  useUpdateNotificationPreferences,
} from '@/api/hooks/featureHooks';
import type { MerchantAlertDto, NotificationEventResponseDto } from '@/types/notifications';

type AlertView = 'attention' | 'activity' | 'history';

function relativeTime(iso: string) {
  const hours = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  return hours < 1 ? 'Now' : hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export default function NotificationsScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const [view, setView] = useState<AlertView>('attention');
  const alerts = useMerchantAlerts(view === 'history' ? 'history' : 'attention');
  const workspace = useNotificationsWorkspace();
  const markRead = useMarkMerchantAlertRead();
  const dismiss = useDismissMerchantAlert();
  const updatePrefs = useUpdateNotificationPreferences();
  const retryEvent = useRetryNotificationEvent();
  const operationalPush = workspace.data?.preferences.push_enabled ?? false;

  function openAlert(alert: MerchantAlertDto) {
    markRead.mutate(alert.id);
    if (alert.action_path) router.push(alert.action_path as never);
  }

  function setOperationalPush(value: boolean) {
    updatePrefs.mutate(
      {
        push_enabled: value,
        event_prefs: {
          'sync.failed': { push: value },
          'credit.offer': { push: value },
          'kyc_reviewed': { push: value },
        },
      },
      {
        onError: () => Alert.alert('Error', 'Could not update notification preferences. Try again.'),
      }
    );
  }

  function eventTitle(event: NotificationEventResponseDto) {
    return event.event_type.replace(/\./g, ' ');
  }

  function eventTone(status: string) {
    const normalized = status.toLowerCase();
    if (['failed', 'undelivered'].includes(normalized)) return { icon: 'alert-circle-outline', color: colors.danger, bg: `${colors.danger}12` };
    if (['pending', 'queued', 'retrying'].includes(normalized)) return { icon: 'clock-outline', color: '#b6831e', bg: '#fff5cc' };
    return { icon: 'check-circle-outline', color: colors.brand, bg: `${colors.brand}12` };
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Notifications</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>
          {alerts.data?.unread_count ? `${alerts.data.unread_count} unread` : 'Actionable business alerts'}
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['attention', 'Needs attention'], ['activity', 'Activity'], ['history', 'History']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} onPress={() => setView(key)} style={{ paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: view === key ? colors.ink : colors.surface, borderWidth: 1, borderColor: view === key ? colors.ink : colors.border }}>
              <Text style={{ color: view === key ? '#fff' : colors.muted, fontFamily: fonts.bodySemiBold }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {view === 'attention' && (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
            <View style={{ padding: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold }}>Critical alerts</Text>
              <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>Always enabled in-app with immediate push for financial and data-risk problems.</Text>
            </View>
            <View style={{ padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold }}>Operational alert push</Text>
                <Text style={{ color: colors.muted, fontSize: 11.5 }}>Optional push for low stock and KYC updates.</Text>
              </View>
              <Switch value={operationalPush} onValueChange={setOperationalPush} trackColor={{ false: colors.border, true: colors.brand }} />
            </View>
          </View>
        )}

        <TouchableOpacity onPress={() => router.push('/owner/message-deliveries' as never)} style={{ padding: 13, borderRadius: 12, backgroundColor: `${colors.brand}12`, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <MaterialCommunityIcons name="message-check-outline" size={19} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold }}>Customer message history</Text>
            <Text style={{ color: colors.muted, fontSize: 11.5 }}>Invoices, credit reminders, retries, and delivery status.</Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.muted} />
        </TouchableOpacity>

        {view === 'activity' && (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
            {workspace.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 16 }} />}
            {!workspace.isLoading && (workspace.data?.events.length ?? 0) === 0 && (
              <Text style={{ color: colors.muted, textAlign: 'center', padding: 14 }}>No notification activity yet.</Text>
            )}
            {(workspace.data?.events ?? []).map((event, index) => {
              const tone = eventTone(event.status);
              return (
                <View key={event.id} style={{ padding: 12, borderBottomWidth: index < (workspace.data?.events.length ?? 0) - 1 ? 1 : 0, borderBottomColor: colors.border, gap: 7 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 9 }}>
                    <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tone.bg }}>
                      <MaterialCommunityIcons name={tone.icon as never} size={16} color={tone.color} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.bodySemiBold, textTransform: 'capitalize' }}>{eventTitle(event)}</Text>
                        <Text style={{ color: colors.muted, fontSize: 10.5 }}>{relativeTime(event.created_at)}</Text>
                      </View>
                      <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{event.message}</Text>
                      <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 3 }}>{event.event_type}</Text>
                      <Text style={{ color: tone.color, fontSize: 10.5, marginTop: 3, textTransform: 'capitalize' }}>
                        {event.status}{event.channel ? ` · ${event.channel}` : ''}
                      </Text>
                    </View>
                  </View>
                  {event.retryable ? (
                    <TouchableOpacity
                      disabled={retryEvent.isPending}
                      onPress={() => retryEvent.mutate(event.id)}
                      style={{ alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.inverse, opacity: retryEvent.isPending ? 0.6 : 1 }}
                    >
                      <Text style={{ color: '#fff', fontFamily: fonts.bodySemiBold }}>Retry</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        {view !== 'activity' && alerts.isLoading && <ActivityIndicator color={colors.brand} />}
        {view !== 'activity' && !alerts.isLoading && (alerts.data?.items.length ?? 0) === 0 && (
          <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 24 }}>
            {view === 'attention' ? 'No problems need attention.' : 'No resolved alerts yet.'}
          </Text>
        )}
        {view !== 'activity' && (alerts.data?.items ?? []).map((alert) => (
          <View key={alert.id} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: alert.severity === 'critical' ? `${colors.danger}55` : colors.border, borderRadius: 14, padding: 13, gap: 7 }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
              <MaterialCommunityIcons name={alert.severity === 'critical' ? 'alert-circle-outline' : 'bell-outline'} size={19} color={alert.severity === 'critical' ? colors.danger : colors.brand} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Text style={{ flex: 1, color: colors.ink, fontFamily: fonts.bodySemiBold }}>{alert.title}</Text>
                  <Text style={{ color: colors.muted, fontSize: 10.5 }}>{relativeTime(alert.latest_at)}</Text>
                </View>
                <Text style={{ color: colors.muted, fontSize: 12, marginTop: 2 }}>{alert.message}</Text>
                {alert.occurrence_count > 1 && <Text style={{ color: colors.muted, fontSize: 10.5, marginTop: 3 }}>Updated {alert.occurrence_count} times</Text>}
              </View>
            </View>
            {view === 'attention' && (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {alert.action_label && alert.action_path && (
                  <TouchableOpacity onPress={() => openAlert(alert)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, backgroundColor: colors.brand }}>
                    <Text style={{ color: '#fff', fontFamily: fonts.bodySemiBold }}>{alert.action_label}</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => Alert.alert('Dismiss alert?', 'Dismiss this alert after handling it outside SMEFlow.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Dismiss', onPress: () => dismiss.mutate({ alertId: alert.id, reason: 'Handled outside SMEFlow' }) }])} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: colors.border }}>
                  <Text style={{ color: colors.muted }}>Dismiss</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}
