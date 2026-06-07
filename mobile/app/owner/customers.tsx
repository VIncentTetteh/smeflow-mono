import { useEffect, useRef, useState } from 'react';
import { Modal, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
import { useCustomer, useCustomers } from '@/api/hooks/featureHooks';
import type { CustomerListItemDto } from '@/types/sales';

function relativeTime(iso: string | null) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' });
}

function CustomerDetailModal({ customerId, onClose }: { customerId: string; onClose: () => void }) {
  const { colors, fonts } = useTheme();
  const { data: detail, isLoading } = useCustomer(customerId);

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={{ flex: 1 }}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={onClose} />
        <ScrollView
          style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '80%' }}
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        >
          {/* Handle */}
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: 'center', marginBottom: 16 }} />

          {isLoading || !detail ? (
            <Text style={{ color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>Loading…</Text>
          ) : (
            <>
              {/* Name & phone */}
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>{detail.name ?? 'Walk-in'}</Text>
              {detail.phone && (
                <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.mono, marginTop: 2 }}>{detail.phone}</Text>
              )}
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                Customer since {new Date(detail.since).toLocaleDateString('en-GH', { month: 'short', year: 'numeric' })}
              </Text>

              {/* Stats grid */}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                {[
                  { label: 'Purchases', value: String(detail.stats.purchase_count) },
                  { label: 'Lifetime Value', value: `GH₵ ${Number(detail.stats.lifetime_value).toLocaleString('en-GH', { minimumFractionDigits: 0 })}` },
                  { label: 'Total Paid', value: `GH₵ ${Number(detail.stats.total_paid).toFixed(2)}` },
                  { label: 'Outstanding', value: `GH₵ ${Number(detail.stats.outstanding_credit).toFixed(2)}`, highlight: Number(detail.stats.outstanding_credit) > 0 },
                ].map((s) => (
                  <View key={s.label} style={{
                    flex: 1, minWidth: '45%', padding: 10, borderRadius: 10,
                    backgroundColor: s.highlight ? '#fff5cc' : `${colors.ink}06`,
                  }}>
                    <Text style={{ fontSize: 10, color: s.highlight ? '#b6831e' : colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {s.label}
                    </Text>
                    <Text style={{ fontSize: 15, fontFamily: fonts.displaySemiBold, color: s.highlight ? '#b6831e' : colors.ink, marginTop: 2 }}>
                      {s.value}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Recent sales */}
              {detail.recent_sales.length > 0 && (
                <>
                  <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 }}>
                    Recent sales
                  </Text>
                  {detail.recent_sales.slice(0, 5).map((s) => (
                    <View key={s.id} style={{
                      flexDirection: 'row', alignItems: 'center',
                      paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border,
                    }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                          GH₵ {Number(s.total).toFixed(2)}
                        </Text>
                        <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.mono }}>
                          {s.payment_method.toUpperCase()} · {relativeTime(s.created_at)}
                        </Text>
                      </View>
                      <View style={{
                        paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
                        backgroundColor: s.status === 'paid' ? `${colors.brand}15` : '#fff5cc',
                      }}>
                        <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: s.status === 'paid' ? colors.brand : '#b6831e' }}>
                          {s.status === 'paid' ? 'Paid' : s.status}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              )}

              {/* Top items */}
              {detail.top_items.length > 0 && (
                <>
                  <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 18, marginBottom: 8 }}>
                    Top items bought
                  </Text>
                  {detail.top_items.slice(0, 4).map((item) => (
                    <View key={item.description} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 }}>
                      <Text style={{ fontSize: 12.5, color: colors.ink, flex: 1 }} numberOfLines={1}>{item.description}</Text>
                      <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.mono }}>{Number(item.total_qty).toFixed(0)} units</Text>
                    </View>
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

export default function CustomersScreen() {
  const { colors, fonts } = useTheme();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const { data, isLoading } = useCustomers(debouncedSearch || undefined);
  const customers: CustomerListItemDto[] = data?.items ?? [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Header */}
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Customers</Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{data?.total ?? 0} total</Text>
      </View>

      <PlanGatedScreen feature="customers">
      {/* Search */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8 }}>
        <View style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          paddingHorizontal: 12, height: 40,
          backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12,
        }}>
          <MaterialCommunityIcons name="magnify" size={16} color={colors.muted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name or phone"
            placeholderTextColor={colors.muted}
            style={{ flex: 1, fontSize: 13.5, color: colors.ink, fontFamily: fonts.body }}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <MaterialCommunityIcons name="close" size={14} color={colors.muted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
        {isLoading ? (
          <Text style={{ color: colors.muted, textAlign: 'center', marginTop: 40 }}>Loading…</Text>
        ) : customers.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 60, gap: 8 }}>
            <MaterialCommunityIcons name="account-group-outline" size={40} color={colors.border} />
            <Text style={{ fontSize: 14, color: colors.muted }}>No customers yet</Text>
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>
              Customers appear here once you record a sale with their name or phone number.
            </Text>
          </View>
        ) : (
          customers.map((c) => {
            const hasDebt = Number(c.outstanding_credit) > 0;
            return (
              <TouchableOpacity
                key={String(c.id)}
                onPress={() => setSelectedId(String(c.id))}
                activeOpacity={0.85}
                style={{
                  backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                  borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11,
                  marginBottom: 7, flexDirection: 'row', alignItems: 'center', gap: 10,
                }}
              >
                {/* Avatar */}
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: `${colors.ink}10`, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {(c.name ?? 'W').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                      {c.name ?? 'Walk-in'}
                    </Text>
                    {hasDebt && (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: '#fff5cc' }}>
                        <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>
                          GH₵ {Number(c.outstanding_credit).toFixed(0)} owed
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.mono, marginTop: 1 }}>
                    {c.phone ?? '—'} · {c.purchase_count} purchase{c.purchase_count !== 1 ? 's' : ''} · last {relativeTime(c.last_purchase_at)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13.5, color: colors.ink }}>
                    GH₵ {Number(c.lifetime_value).toLocaleString('en-GH', { minimumFractionDigits: 0 })}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.muted, marginTop: 1 }}>lifetime</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {selectedId && (
        <CustomerDetailModal customerId={selectedId} onClose={() => setSelectedId(null)} />
      )}
      </PlanGatedScreen>
    </SafeAreaView>
  );
}
