import { useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { usePeriodSummary, useSalesHistory } from '@/api/hooks/featureHooks';
import type { SaleResponseDto } from '@/types/sales';
import { useTheme } from '@/lib/theme';
import { SaleDetailSheet, canRetryPayment, saleStatusBadge } from '@/components/sales/SaleDetailSheet';

type Filter = 'Today' | 'Week' | 'Month' | 'All';

function ghc(v: number | string) {
  return `GH₵ ${Number(v).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function methodLabel(method: string | undefined) {
  if (!method) return '—';
  if (method === 'momo') return 'MoMo';
  if (method === 'cash') return 'Cash';
  if (method === 'mixed') return 'Split';
  if (method === 'credit') return 'Credit';
  return method.toUpperCase();
}

function methodColors(method: string) {
  if (method === 'momo') return { bg: '#f6c600', fg: '#1a1208' };
  if (method === 'telecel') return { bg: '#d71920', fg: '#fff' };
  if (method === 'at') return { bg: '#0072ce', fg: '#fff' };
  if (method === 'credit') return { bg: '#fff5cc', fg: '#b6831e' };
  return { bg: '#e8e5de', fg: '#6b6860' };
}


function periodDates(filter: Filter): { from_date: string; to_date: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (filter === 'Today') return { from_date: to, to_date: to };
  if (filter === 'Week') {
    const from = new Date(now); from.setDate(now.getDate() - 7);
    return { from_date: from.toISOString().slice(0, 10), to_date: to };
  }
  if (filter === 'Month') {
    const from = new Date(now); from.setMonth(now.getMonth() - 1);
    return { from_date: from.toISOString().slice(0, 10), to_date: to };
  }
  const from = new Date(now); from.setFullYear(now.getFullYear() - 1);
  return { from_date: from.toISOString().slice(0, 10), to_date: to };
}


// ─── Main Sales Screen ──────────────────────────────────────────────────────
export default function SalesScreen() {
  const { colors, fonts } = useTheme();
  const [filter, setFilter] = useState<Filter>('Today');
  const [methodFilter, setMethodFilter] = useState<string>('all');
  const [showMethodPicker, setShowMethodPicker] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);

  const period = periodDates(filter);
  const salesQuery = useSalesHistory({
    from_date: period.from_date,
    to_date: period.to_date,
    payment_method: methodFilter !== 'all' ? methodFilter : undefined,
  });
  const { data: periodData } = usePeriodSummary(period);

  const saleRows: SaleResponseDto[] = (salesQuery.data as SaleResponseDto[] | undefined) ?? [];
  const localTotal = saleRows.filter((s) => s.status === 'paid').reduce((a, b) => a + Number(b.total), 0);
  const total   = Number(periodData?.total_revenue ?? localTotal);
  const cash    = Number(periodData?.cash_revenue   ?? 0);
  const momo    = Number(periodData?.momo_revenue   ?? 0);
  const credit  = Number(periodData?.credit_revenue ?? 0);
  const txCount = periodData?.total_sales ?? saleRows.length;

  // Counts for actionable insights
  const pendingCount = saleRows.filter((s) => s.status === 'pending_payment').length;
  const failedCount  = saleRows.filter((s) => s.status === 'failed' || s.payment_status === 'failed').length;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        flexDirection: 'row', alignItems: 'center',
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Sales</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>
            {filter} · {saleRows.length} transaction{saleRows.length !== 1 ? 's' : ''}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => setShowMethodPicker(true)}
          style={{
            width: 36, height: 36, borderRadius: 10,
            backgroundColor: methodFilter !== 'all' ? `${colors.brand}15` : `${colors.ink}08`,
            alignItems: 'center', justifyContent: 'center',
          }}>
          <MaterialCommunityIcons name="tune-variant" size={18} color={methodFilter !== 'all' ? colors.brand : colors.muted} />
        </TouchableOpacity>
      </View>

      {/* Filter chips + total */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {(['Today', 'Week', 'Month', 'All'] as Filter[]).map((f) => {
          const sel = filter === f;
          return (
            <TouchableOpacity key={f} onPress={() => setFilter(f)} style={{
              paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: sel ? colors.ink : colors.surface,
              borderWidth: sel ? 0 : 1, borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: sel ? '#fdf7eb' : colors.muted }}>
                {f}
              </Text>
            </TouchableOpacity>
          );
        })}
        <View style={{ flex: 1 }} />
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13, color: colors.ink }}>
          GH₵ {total.toFixed(2)}
        </Text>
      </View>

      {/* Payment method breakdown */}
      {periodData && (
        <View style={{
          flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 8,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          {([
            { label: 'Cash',   value: cash },
            { label: 'MoMo',   value: momo },
            { label: 'Credit', value: credit },
          ] as const).map((m) => (
            <View key={m.label} style={{ flex: 1, alignItems: 'center' }}>
              <Text style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {m.label}
              </Text>
              <Text style={{ fontSize: 13, fontFamily: fonts.displaySemiBold, color: colors.ink, marginTop: 1 }}>
                GH₵ {Number(m.value).toFixed(0)}
              </Text>
            </View>
          ))}
          <View style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Sales
            </Text>
            <Text style={{ fontSize: 13, fontFamily: fonts.displaySemiBold, color: colors.ink, marginTop: 1 }}>
              {txCount}
            </Text>
          </View>
        </View>
      )}

      {/* Actionable alerts */}
      {(pendingCount > 0 || failedCount > 0) && (
        <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
          {pendingCount > 0 && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: '#fff8e1', borderRadius: 10, padding: 10, marginBottom: 6,
              borderLeftWidth: 3, borderLeftColor: '#f59e0b',
            }}>
              <MaterialCommunityIcons name="clock-outline" size={16} color="#92650a" />
              <Text style={{ flex: 1, fontSize: 12, color: '#78350f' }}>
                <Text style={{ fontFamily: fonts.bodySemiBold }}>{pendingCount} MoMo payment{pendingCount > 1 ? 's' : ''} pending</Text>
                {' '}— tap the sale to resend the prompt
              </Text>
            </View>
          )}
          {failedCount > 0 && (
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 8,
              backgroundColor: '#fee2e2', borderRadius: 10, padding: 10, marginBottom: 6,
              borderLeftWidth: 3, borderLeftColor: '#dc2626',
            }}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color="#dc2626" />
              <Text style={{ flex: 1, fontSize: 12, color: '#7f1d1d' }}>
                <Text style={{ fontFamily: fonts.bodySemiBold }}>{failedCount} payment{failedCount > 1 ? 's' : ''} failed</Text>
                {' '}— tap to retry
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Sale list */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 24 }}>
        {salesQuery.isLoading && (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        )}
        {salesQuery.isError && (
          <View style={{ paddingTop: 24, paddingHorizontal: 4 }}>
            <Text style={{ color: colors.danger, fontSize: 13, textAlign: 'center' }}>
              {String((salesQuery.error as Error)?.message ?? '').includes('401')
                ? 'Session expired — pull to refresh'
                : 'Could not load sales. Pull down to retry.'}
            </Text>
          </View>
        )}
        {!salesQuery.isLoading && !salesQuery.isError && saleRows.length === 0 && (
          <View style={{ paddingTop: 40, alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="receipt" size={32} color={colors.border} />
            <Text style={{ fontSize: 13, color: colors.muted }}>No sales recorded yet</Text>
          </View>
        )}
        {saleRows.map((s) => {
          const mc = methodColors(s.payment_method);
          const badge = saleStatusBadge(s.status, s.payment_status);
          const needsAction = canRetryPayment(s);
          const isVoided = s.status === 'voided';
          const amount = Number(s.total);

          return (
            <TouchableOpacity
              key={String(s.id)}
              onPress={() => setSelectedSaleId(String(s.id))}
              activeOpacity={0.8}
              style={{
                backgroundColor: needsAction ? `${colors.gold}08` : colors.surface,
                borderWidth: 1,
                borderColor: needsAction ? `${colors.gold}40` : colors.border,
                borderRadius: 14,
                paddingHorizontal: 13,
                paddingVertical: 11,
                marginBottom: 7,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
              }}>
              {/* Provider badge */}
              <View style={{
                paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8,
                backgroundColor: isVoided ? '#f3f4f6' : mc.bg,
                minWidth: 42, alignItems: 'center',
              }}>
                <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: isVoided ? '#9ca3af' : mc.fg }}>
                  {methodLabel(s.payment_method)}
                </Text>
              </View>

              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: isVoided ? colors.muted : colors.ink }}>
                    {s.customer_id ? 'Customer' : 'Walk-in'}
                  </Text>
                  {/* Status badge */}
                  <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: badge.bg }}>
                    <Text style={{ fontSize: 9.5, fontFamily: fonts.bodySemiBold, color: badge.text }}>
                      {badge.label}
                    </Text>
                  </View>
                </View>
                <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.mono, marginTop: 1 }}>
                  {new Date(s.created_at).toLocaleTimeString('en-GH', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}{s.items.length} item{s.items.length !== 1 ? 's' : ''}
                </Text>
              </View>

              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text style={{
                  fontFamily: fonts.displaySemiBold, fontSize: 14,
                  color: isVoided ? colors.muted : colors.ink,
                  textDecorationLine: isVoided ? 'line-through' : 'none',
                }}>
                  GH₵ {amount.toFixed(2)}
                </Text>
                {needsAction && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <MaterialCommunityIcons name="chevron-right" size={14} color={colors.muted} />
                    <Text style={{ fontSize: 10, color: colors.muted }}>Tap to retry</Text>
                  </View>
                )}
                {!needsAction && (
                  <MaterialCommunityIcons name="chevron-right" size={16} color={colors.border} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Sale detail sheet */}
      {selectedSaleId && (
        <SaleDetailSheet
          saleId={selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
        />
      )}

      {/* Method filter modal */}
      <Modal
        visible={showMethodPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowMethodPicker(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
          onPress={() => setShowMethodPicker(false)}
        >
          <Pressable onPress={() => { /* stop propagation */ }}>
            <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingBottom: 32 }}>
              <View style={{ alignItems: 'center', paddingTop: 10 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.ink}20` }} />
              </View>
              <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>Filter by method</Text>
              </View>
              {(['all', 'cash', 'momo', 'credit', 'mixed'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  onPress={() => { setMethodFilter(m); setShowMethodPicker(false); }}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 16, paddingVertical: 14,
                    borderBottomWidth: 1, borderBottomColor: colors.border,
                  }}
                >
                  <Text style={{ flex: 1, fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink, textTransform: 'capitalize' }}>
                    {m === 'all' ? 'All methods' : methodLabel(m)}
                  </Text>
                  {methodFilter === m && <MaterialCommunityIcons name="check" size={18} color={colors.brand} />}
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
