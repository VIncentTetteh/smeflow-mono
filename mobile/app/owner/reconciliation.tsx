/**
 * Full reconciliation screen — paginated view of all unmatched MoMo/card
 * collections with per-item Ignore action and pagination.
 */
import { useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useIgnoreReconciliationItem, useReconciliationInbox, useUnignoreReconciliationItem } from '@/api/hooks/featureHooks';

const PAGE_SIZE = 25;

const PROVIDER_COLORS: Record<string, { bg: string; fg: string }> = {
  mtn:        { bg: '#f6c600', fg: '#1a1208' },
  vodafone:   { bg: '#d71920', fg: '#fff' },
  airteltigo: { bg: '#0072ce', fg: '#fff' },
};

function providerColor(provider: string) {
  return PROVIDER_COLORS[provider?.toLowerCase() ?? ''] ?? { bg: '#6b6860', fg: '#fff' };
}

function providerLabel(provider: string) {
  const map: Record<string, string> = { mtn: 'MTN', vodafone: 'TC', airteltigo: 'AT' };
  return map[provider?.toLowerCase() ?? ''] ?? provider?.toUpperCase().slice(0, 6) ?? '?';
}

function money(amount: unknown) {
  return `GH₵ ${Number(amount ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

type MatchState = 'unmatched' | 'suggested_match' | 'matched' | 'ignored' | 'refunded';

const STATE_LABELS: Record<MatchState, { label: string; color: string }> = {
  unmatched:       { label: 'Needs review', color: '#b6831e' },
  suggested_match: { label: 'Suggested',    color: '#1a73e8' },
  matched:         { label: 'Linked',        color: '#2eb585' },
  ignored:         { label: 'Ignored',       color: '#6b6860' },
  refunded:        { label: 'Refunded',      color: '#b8351c' },
};

type FilterMode = 'unmatched' | 'all';

export default function ReconciliationScreen() {
  const { colors, fonts, radii } = useTheme();
  const router = useRouter();
  const [offset, setOffset] = useState(0);
  const [filter, setFilter] = useState<FilterMode>('unmatched');
  const includeIgnored = filter === 'all';

  const { data, isLoading, isError, refetch, isFetching } = useReconciliationInbox({
    include_ignored: includeIgnored,
    limit: PAGE_SIZE,
    offset,
  });

  const ignore = useIgnoreReconciliationItem();
  const unignore = useUnignoreReconciliationItem();

  const items = data?.items ?? [];
  const summary = data?.summary;
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  function handleIgnore(paymentId: string, isIgnored: boolean) {
    const action = isIgnored ? unignore : ignore;
    Alert.alert(
      isIgnored ? 'Restore to queue?' : 'Ignore this payment?',
      isIgnored
        ? 'This will move the payment back to the unmatched queue.'
        : 'The payment will be removed from your review queue. Funds are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isIgnored ? 'Restore' : 'Ignore',
          style: isIgnored ? 'default' : 'destructive',
          onPress: () => action.mutate(paymentId, {
            onError: () => Alert.alert('Error', 'Could not update. Please try again.'),
          }),
        },
      ]
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 4 }}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.ink} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>
            Payment reconciliation
          </Text>
          {summary && (
            <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>
              {summary.unmatched} needs review · {summary.matched} linked · {summary.ignored} ignored
            </Text>
          )}
        </View>
      </View>

      {/* Filter chips */}
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        {(['unmatched', 'all'] as FilterMode[]).map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => { setFilter(f); setOffset(0); }}
            style={{
              paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999,
              backgroundColor: filter === f ? colors.ink : colors.surface,
              borderWidth: 1, borderColor: filter === f ? colors.ink : colors.border,
            }}
          >
            <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: filter === f ? '#fdf7eb' : colors.muted }}>
              {f === 'unmatched' ? 'Needs review' : 'All payments'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => { setOffset(0); void refetch(); }} tintColor={colors.brand} />}
      >
        {isLoading ? (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : isError ? (
          <View style={{ paddingTop: 40, alignItems: 'center', gap: 8 }}>
            <MaterialCommunityIcons name="alert-circle-outline" size={28} color={colors.danger} />
            <Text style={{ color: colors.muted, fontSize: 13 }}>Could not load payments. Pull to retry.</Text>
          </View>
        ) : items.length === 0 ? (
          <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: `${colors.brand}15`, alignItems: 'center', justifyContent: 'center' }}>
              <MaterialCommunityIcons name="check-circle-outline" size={26} color={colors.brand} />
            </View>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>All clear</Text>
            <Text style={{ color: colors.muted, fontSize: 13, textAlign: 'center', maxWidth: 280 }}>
              {filter === 'unmatched'
                ? 'No payments need review. Switch to "All payments" to see the full history.'
                : 'No payment records found.'}
            </Text>
          </View>
        ) : (
          <View style={{
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: radii.md, overflow: 'hidden', marginTop: 4,
          }}>
            {items.map((item, i) => {
              const stateConfig = STATE_LABELS[item.match_state as MatchState] ?? { label: item.match_state, color: colors.muted };
              const isIgnored = item.match_state === 'ignored';
              const isMatchedOrRefunded = item.match_state === 'matched' || item.match_state === 'refunded';
              const pc = providerColor(item.provider ?? '');

              return (
                <View
                  key={item.id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 12,
                    paddingHorizontal: 14, paddingVertical: 12,
                    borderBottomWidth: i < items.length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                    opacity: isIgnored ? 0.55 : 1,
                  }}
                >
                  {/* Provider badge */}
                  <View style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: pc.bg, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: pc.fg }}>
                      {providerLabel(item.provider ?? '')}
                    </Text>
                  </View>

                  {/* Details */}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13.5, color: colors.ink }}>
                        {money(item.amount)}
                      </Text>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: `${stateConfig.color}18` }}>
                        <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: stateConfig.color }}>
                          {stateConfig.label}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2 }} numberOfLines={1}>
                      {item.phone ?? 'Unknown payer'} · {item.external_ref ?? 'No ref'} · {shortDate(item.confirmed_at ?? item.created_at)}
                    </Text>
                    {item.invoice_id && (
                      <Text style={{ fontSize: 11, color: colors.brand, marginTop: 1 }}>
                        Linked to invoice
                      </Text>
                    )}
                    {item.sale_id && (
                      <Text style={{ fontSize: 11, color: colors.brand, marginTop: 1 }}>
                        Linked to sale
                      </Text>
                    )}
                  </View>

                  {/* Action */}
                  {!isMatchedOrRefunded && (
                    <TouchableOpacity
                      onPress={() => handleIgnore(item.id, isIgnored)}
                      disabled={ignore.isPending || unignore.isPending}
                      style={{
                        paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
                        borderWidth: 1, borderColor: colors.border,
                        backgroundColor: colors.bg, flexShrink: 0,
                      }}
                    >
                      <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: isIgnored ? colors.brand : colors.muted }}>
                        {isIgnored ? 'Restore' : 'Ignore'}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Pagination */}
        {total > PAGE_SIZE && (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, gap: 8 }}>
            <TouchableOpacity
              onPress={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
                borderColor: colors.border, backgroundColor: colors.surface,
                alignItems: 'center', opacity: offset === 0 ? 0.4 : 1,
              }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink }}>← Previous</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 12, color: colors.muted }}>
              {currentPage} / {totalPages}
            </Text>
            <TouchableOpacity
              onPress={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
                borderColor: colors.border, backgroundColor: colors.surface,
                alignItems: 'center', opacity: offset + PAGE_SIZE >= total ? 0.4 : 1,
              }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.ink }}>Next →</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
