import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, RefreshControl, ScrollView, Share, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Text } from '@/components/ui/Text';
import {
  useCreateCreditRepaymentIntent,
  useInvoice,
  useInvoices,
  useRecordCreditPayment,
  useSendInvoice,
  useVoidInvoice,
} from '@/api/hooks/featureHooks';
import type { InvoiceResponseDto } from '@/types/invoices';
import { useTheme } from '@/lib/theme';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';


function statusPill(status: string, colors: { brand: string; danger: string; gold: string }) {
  if (status === 'paid')    return { bg: `${colors.brand}15`, text: colors.brand };
  if (status === 'overdue') return { bg: `${colors.danger}15`, text: colors.danger };
  if (status === 'issued' || status === 'due') return { bg: '#fff5cc', text: '#b6831e' };
  return { bg: `#6b686015`, text: '#6b6860' };
}

function ghc(value: number | string) {
  return `GH₵ ${Number(value).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactGhc(value: number) {
  return value >= 1000 ? `GH₵ ${(value / 1000).toFixed(1)}k` : ghc(value);
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

type TypeFilter = 'all' | 'receipt' | 'invoice';
type DateFilter = 'Today' | 'Week' | 'Month' | 'All';

function periodDates(filter: DateFilter): { from_date?: string; to_date?: string } {
  if (filter === 'All') return {};
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  if (filter === 'Today') return { from_date: to, to_date: to };
  if (filter === 'Week') {
    const from = new Date(now); from.setDate(now.getDate() - 7);
    return { from_date: from.toISOString().slice(0, 10), to_date: to };
  }
  const from = new Date(now); from.setMonth(now.getMonth() - 1);
  return { from_date: from.toISOString().slice(0, 10), to_date: to };
}

export default function InvoicesScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const [dateFilter, setDateFilter] = useState<DateFilter>('All');
  const invoicesQuery = useInvoices(periodDates(dateFilter));
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: detail } = useInvoice(selectedId);
  const sendInvoice = useSendInvoice();
  const voidInvoice = useVoidInvoice();
  const recordCreditPayment = useRecordCreditPayment();
  const createRepaymentIntent = useCreateCreditRepaymentIntent();
  const [repaymentAmount, setRepaymentAmount] = useState('');

  function validRepaymentAmount(balanceDue: number) {
    const amount = Number(repaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > balanceDue) {
      Alert.alert('Enter a valid amount', `The repayment must be more than GH₵ 0 and no more than ${ghc(balanceDue)}.`);
      return null;
    }
    return amount;
  }

  async function handleRefresh() {
    setRefreshing(true);
    await invoicesQuery.refetch();
    setRefreshing(false);
  }

  const allRows = (invoicesQuery.data ?? []).map((inv: InvoiceResponseDto) => {
    const isReceipt = inv.type === 'receipt';
    const isOverdue = inv.effective_status === 'overdue';
    const effectiveStatus = inv.effective_status ?? inv.status;
    // Receipts from paid sales show as "Paid" even if backend status is "issued"
    const dueLabel = isReceipt && inv.status !== 'draft' && inv.status !== 'cancelled'
      ? 'Paid'
      : inv.status === 'paid' ? 'Paid'
      : inv.status === 'draft' ? 'Draft'
      : isOverdue ? 'Overdue' : 'Due';
    return {
      id:       inv.invoice_number || inv.id.slice(0, 8).toUpperCase(),
      actualId: inv.id,
      cust:     inv.customer_name || inv.supplier_name || 'Walk-in',
      amount:   parseFloat(String(inv.total)),
      balanceDue: parseFloat(String(inv.balance_due ?? inv.total)),
      due:      dueLabel,
      status:   isReceipt && inv.status !== 'draft' && inv.status !== 'cancelled' ? 'paid' : effectiveStatus,
      vat:      parseFloat(String(inv.vat_amount ?? 0)) > 0,
      type:     inv.type ?? 'invoice',
      dueDate:  inv.due_date,
    };
  });

  const rows = typeFilter === 'all' ? allRows
    : typeFilter === 'receipt' ? allRows.filter((r) => r.type === 'receipt')
    : allRows.filter((r) => r.type !== 'receipt');

  const outstanding = allRows.filter((i) => i.status === 'due' || i.status === 'issued' || i.status === 'overdue').reduce((s, i) => s + i.balanceDue, 0);
  const overdueCount = allRows.filter((i) => i.status === 'overdue').length;
  const paidMo = allRows.filter((i) => i.status === 'paid').reduce((s, i) => s + i.amount, 0);

  const STATS = [
    { label: 'Outstanding', value: outstanding > 0 ? compactGhc(outstanding) : 'GH₵ 0', colorKey: 'gold' as const },
    { label: 'Overdue',     value: overdueCount > 0 ? `${overdueCount} inv.` : 'None',                      colorKey: 'danger' as const },
    { label: 'Paid · Mo',  value: paidMo > 0 ? compactGhc(paidMo) : 'GH₵ 0',                              colorKey: 'brand' as const },
  ];

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
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Invoices</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>GRA-compliant · with VAT, NHIL, GETFL</Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/owner/new-invoice' as never)}
          style={{
            paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10,
            backgroundColor: colors.ink, flexDirection: 'row', alignItems: 'center', gap: 5,
          }}
        >
          <MaterialCommunityIcons name="plus" size={14} color="#fdf7eb" />
          <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>New</Text>
        </TouchableOpacity>
      </View>

      <PlanGatedScreen feature="invoices">
      {/* Stat cards */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', gap: 8 }}>
        {STATS.map((s) => (
          <View key={s.label} style={{
            flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: 12, padding: 10,
          }}>
            <Text style={{ fontSize: 10, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {s.label}
            </Text>
            <Text style={{
              fontFamily: fonts.displaySemiBold, fontSize: 15, marginTop: 2,
              color: s.colorKey === 'danger' ? colors.danger : s.colorKey === 'gold' ? '#b6831e' : colors.brand,
            }}>
              {s.value}
            </Text>
          </View>
        ))}
      </View>

      {/* Date filter chips */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 6, flexDirection: 'row', gap: 6 }}>
        {(['Today', 'Week', 'Month', 'All'] as DateFilter[]).map((f) => {
          const sel = dateFilter === f;
          return (
            <TouchableOpacity key={f} onPress={() => setDateFilter(f)} style={{
              paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: sel ? colors.brand : colors.surface,
              borderWidth: sel ? 0 : 1, borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: sel ? '#fff' : colors.muted }}>
                {f}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Type filter chips */}
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, flexDirection: 'row', gap: 6 }}>
        {([
          { key: 'all',     label: 'All' },
          { key: 'receipt', label: 'Receipts' },
          { key: 'invoice', label: 'B2B' },
        ] as const).map((t) => {
          const sel = typeFilter === t.key;
          return (
            <TouchableOpacity key={t.key} onPress={() => setTypeFilter(t.key)} style={{
              paddingVertical: 5, paddingHorizontal: 12, borderRadius: 999,
              backgroundColor: sel ? colors.ink : colors.surface,
              borderWidth: sel ? 0 : 1, borderColor: colors.border,
            }}>
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: sel ? '#fdf7eb' : colors.muted }}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Invoice list */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void handleRefresh()} tintColor={colors.brand} />}
      >
        {invoicesQuery.isLoading && (
          <View style={{ paddingTop: 40, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        )}
        {invoicesQuery.isError && (
          <View style={{ paddingTop: 24 }}>
            <Text style={{ color: colors.danger, fontSize: 13, textAlign: 'center' }}>
              {String((invoicesQuery.error as Error)?.message ?? '').includes('401')
                ? 'Session expired — pull to refresh'
                : 'Could not load invoices. Pull down to retry.'}
            </Text>
          </View>
        )}
        {!invoicesQuery.isLoading && !invoicesQuery.isError && rows.length === 0 && (
          <View style={{ paddingTop: 40, alignItems: 'center', gap: 6 }}>
            <MaterialCommunityIcons name="file-document-outline" size={32} color={colors.border} />
            <Text style={{ fontSize: 13, color: colors.muted }}>No receipts or invoices yet</Text>
            <Text style={{ fontSize: 12, color: colors.muted, textAlign: 'center' }}>
              Record a sale to create a receipt automatically, or tap New for a manual B2B invoice.
            </Text>
          </View>
        )}
        {rows.map((inv) => {
          const pill = statusPill(inv.status, colors);
          return (
            <TouchableOpacity key={inv.id} onPress={() => inv.actualId && setSelectedId(inv.actualId)} style={{
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              borderRadius: 14, padding: 12, marginBottom: 8,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={{ width: 36, height: 36, borderRadius: 9, backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="file-document" size={17} color={colors.muted} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                    {inv.cust}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.mono, marginTop: 1 }}>
                    {inv.id}{inv.vat ? ' · VAT' : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 14.5, color: colors.ink }}>
                    GH₵ {inv.amount.toLocaleString()}
                  </Text>
                  <View style={{ marginTop: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: pill.bg }}>
                    <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: pill.text }}>{inv.due}</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Invoice detail modal */}
      <Modal visible={!!selectedId} transparent animationType="slide" onRequestClose={() => setSelectedId(null)}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setSelectedId(null)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, maxHeight: '85%' }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
              <Text style={{ flex: 1, fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink }}>Invoice Detail</Text>
              <TouchableOpacity onPress={() => setSelectedId(null)}>
                <MaterialCommunityIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>

            {detail ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ gap: 8, marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Invoice #</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>{detail.invoice_number ?? detail.id?.slice(0, 8).toUpperCase()}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Customer</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{detail.customer_name ?? '—'}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Total</Text>
                    <Text style={{ fontSize: 13, fontFamily: fonts.displaySemiBold, color: colors.ink }}>GH₵ {Number(detail.total).toLocaleString()}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>VAT</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>GH₵ {Number(detail.vat_amount ?? 0).toLocaleString()}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Status</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: statusPill(detail.effective_status ?? detail.status, colors).text }}>
                      {titleCase(detail.effective_status ?? detail.status)}
                    </Text>
                  </View>
                  {detail.due_date && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Due date</Text>
                      <Text style={{ fontSize: 12, color: colors.ink }}>
                        {new Date(detail.due_date).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}
                      </Text>
                    </View>
                  )}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Amount paid</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>{ghc(detail.amount_paid)}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Balance due</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: Number(detail.balance_due) > 0 ? colors.danger : colors.brand }}>
                      {ghc(detail.balance_due)}
                    </Text>
                  </View>
                </View>

                {!!detail.sale_id && Number(detail.balance_due) > 0 && (
                  <View style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8, marginBottom: 16 }}>
                    <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold }}>Collect repayment</Text>
                    <TextInput
                      value={repaymentAmount}
                      onChangeText={setRepaymentAmount}
                      keyboardType="decimal-pad"
                      placeholder={`Amount up to ${ghc(detail.balance_due)}`}
                      placeholderTextColor={colors.muted}
                      style={{ height: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, color: colors.ink }}
                    />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity
                        disabled={recordCreditPayment.isPending}
                        onPress={() => {
                          const amount = validRepaymentAmount(Number(detail.balance_due));
                          if (amount === null || !detail.sale_id) return;
                          recordCreditPayment.mutate(
                            { sale_id: String(detail.sale_id), amount, payment_method: 'cash' },
                            {
                              onSuccess: () => setRepaymentAmount(''),
                              onError: (e: Error) => Alert.alert('Payment not recorded', e.message),
                            },
                          );
                        }}
                        style={{ flex: 1, minHeight: 44, borderRadius: 9, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, opacity: recordCreditPayment.isPending ? 0.6 : 1 }}
                      >
                        <Text style={{ color: '#fff', fontSize: 12, textAlign: 'center' }}>Record cash payment</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        disabled={createRepaymentIntent.isPending}
                        onPress={() => {
                          const amount = validRepaymentAmount(Number(detail.balance_due));
                          if (amount === null || !detail.sale_id) return;
                          createRepaymentIntent.mutate(
                            { sale_id: String(detail.sale_id), amount, idempotency_key: `credit-${Date.now()}` },
                            {
                              onSuccess: (intent) => {
                                if (intent.payment_url) void Share.share({ message: intent.payment_url });
                                else Alert.alert('Paystack link not created', 'Paystack did not return a payment link.');
                              },
                              onError: (e: Error) => Alert.alert('Paystack link not created', e.message),
                            },
                          );
                        }}
                        style={{ flex: 1, minHeight: 44, borderRadius: 9, borderWidth: 1, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, opacity: createRepaymentIntent.isPending ? 0.6 : 1 }}
                      >
                        <Text style={{ color: colors.brand, fontSize: 12, textAlign: 'center' }}>Create Paystack payment</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedId) return;
                      sendInvoice.mutate(selectedId, {
                        onSuccess: (result) => {
                          Alert.alert(
                            result.status === 'queued' ? 'Delivery queued' : result.status === 'skipped' ? 'Not queued' : 'Delivery update',
                            result.message,
                          );
                        },
                        onError: (e: Error) => Alert.alert('Error', e.message),
                      });
                    }}
                    disabled={sendInvoice.isPending}
                    style={{
                      flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.brand,
                      alignItems: 'center', justifyContent: 'center',
                      opacity: sendInvoice.isPending ? 0.6 : 1,
                    }}
                  >
                    {sendInvoice.isPending
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Send</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      if (!selectedId) return;
                      Alert.alert('Void invoice?', 'This cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Void', style: 'destructive', onPress: () => {
                            voidInvoice.mutate(selectedId, {
                              onSuccess: () => setSelectedId(null),
                              onError: (e: Error) => Alert.alert('Error', e.message),
                            });
                          },
                        },
                      ]);
                    }}
                    disabled={voidInvoice.isPending}
                    style={{
                      flex: 1, height: 44, borderRadius: 10, borderWidth: 1,
                      borderColor: colors.danger, alignItems: 'center', justifyContent: 'center',
                      opacity: voidInvoice.isPending ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.danger }}>Void</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            ) : (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: 24 }} />
            )}
          </View>
        </View>
      </Modal>
      </PlanGatedScreen>
    </SafeAreaView>
  );
}
