import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useCreateCreditRepaymentIntent, useRecordCreditPayment, useRetrySalePayment, useSale, useVoidSale } from '@/api/hooks/featureHooks';
import { useTheme } from '@/lib/theme';

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

export function saleStatusBadge(
  saleStatus: string,
  paymentStatus?: string | null
): { bg: string; text: string; label: string; icon: string } {
  if (saleStatus === 'voided') return { bg: '#f3f4f6', text: '#6b7280', label: 'Voided', icon: 'cancel' };
  if (saleStatus === 'failed') return { bg: '#fee2e2', text: '#dc2626', label: 'Failed', icon: 'alert-circle-outline' };
  if (saleStatus === 'pending_payment') {
    const ps = paymentStatus ?? 'pending';
    if (ps === 'failed') return { bg: '#fee2e2', text: '#dc2626', label: 'Payment failed', icon: 'alert-circle-outline' };
    if (ps === 'success') return { bg: '#d1fae5', text: '#065f46', label: 'Payment confirmed', icon: 'check-circle-outline' };
    return { bg: '#fff5cc', text: '#b6831e', label: 'Payment pending', icon: 'clock-outline' };
  }
  if (saleStatus === 'paid') return { bg: '#d1fae5', text: '#065f46', label: 'Paid', icon: 'check-circle-outline' };
  if (saleStatus === 'partial') return { bg: '#fff5cc', text: '#b6831e', label: 'Partial', icon: 'minus-circle-outline' };
  if (saleStatus === 'credit') return { bg: '#fff5cc', text: '#b6831e', label: 'Credit', icon: 'file-document-outline' };
  return { bg: '#f3f4f6', text: '#374151', label: saleStatus, icon: 'information-outline' };
}

export function canRetryPayment(s: {
  payment_method?: string;
  status?: string;
  payment_status?: string | null;
}): boolean {
  return (
    s.payment_method === 'momo' &&
    (s.status === 'pending_payment' || s.status === 'failed') &&
    (s.payment_status === 'pending' || s.payment_status === 'failed' || !s.payment_status)
  );
}

interface Props {
  saleId: string;
  onClose: () => void;
}

export function SaleDetailSheet({ saleId, onClose }: Props) {
  const { colors, fonts } = useTheme();
  const { data: sale, isLoading, error } = useSale(saleId);
  const voidSaleMut = useVoidSale();
  const retry = useRetrySalePayment();
  const recordCreditPayment = useRecordCreditPayment();
  const createRepaymentIntent = useCreateCreditRepaymentIntent();
  const [repaymentAmount, setRepaymentAmount] = useState('');

  const badge = sale ? saleStatusBadge(sale.status, sale.payment_status) : null;
  const retryable = sale ? canRetryPayment(sale) : false;
  const isVoided = sale?.status === 'voided';

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={onClose} />
        <View
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            maxHeight: '85%',
          }}
        >
          {/* Handle */}
          <View style={{ alignItems: 'center', paddingTop: 10 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.ink}20` }} />
          </View>

          {/* Header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 16, paddingVertical: 12,
            borderBottomWidth: 1, borderBottomColor: colors.border,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>
                Sale detail
              </Text>
              <Text style={{ fontSize: 11, fontFamily: fonts.mono, color: colors.muted, marginTop: 1 }}>
                {saleId.slice(-12).toUpperCase()}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <MaterialCommunityIcons name="close" size={20} color={colors.muted} />
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={{ padding: 16, gap: 12 }}
            showsVerticalScrollIndicator={false}
          >
            {isLoading && (
              <View style={{ paddingVertical: 32, alignItems: 'center' }}>
                <ActivityIndicator color={colors.brand} />
              </View>
            )}
            {error && !isLoading && (
              <View style={{ paddingVertical: 24, gap: 8, alignItems: 'center' }}>
                <MaterialCommunityIcons name="alert-circle-outline" size={24} color={colors.danger} />
                <Text style={{ color: colors.danger, textAlign: 'center' }}>Sale details could not be loaded.</Text>
                <Text style={{ color: colors.muted, fontSize: 12, textAlign: 'center' }}>{(error as Error).message}</Text>
              </View>
            )}

            {sale && (
              <>
                {/* Status badge */}
                {badge && (
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    backgroundColor: badge.bg, borderRadius: 12, padding: 10,
                  }}>
                    <MaterialCommunityIcons name={badge.icon as never} size={18} color={badge.text} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: badge.text }}>
                        {badge.label}
                      </Text>
                      {sale.payment_provider_message && (
                        <Text style={{ fontSize: 11, color: badge.text, opacity: 0.8, marginTop: 1 }}>
                          {sale.payment_provider_message}
                        </Text>
                      )}
                    </View>
                  </View>
                )}

                {/* MoMo pending explanation */}
                {sale.status === 'pending_payment' && sale.payment_method === 'momo' && (
                  <View style={{
                    backgroundColor: '#fff8e1', borderRadius: 10, padding: 10,
                    borderLeftWidth: 3, borderLeftColor: '#f59e0b',
                  }}>
                    <Text style={{ fontSize: 12, color: '#78350f', lineHeight: 18 }}>
                      A MoMo prompt was sent to{' '}
                      <Text style={{ fontFamily: fonts.bodySemiBold }}>
                        {sale.customer_phone ?? 'the customer'}
                      </Text>.{'\n'}
                      The sale is recorded — funds confirm once they approve.
                    </Text>
                  </View>
                )}

                {/* Summary */}
                <View style={{
                  backgroundColor: colors.bg, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border, padding: 12, gap: 6,
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Date & time</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>
                      {new Date(sale.created_at).toLocaleString('en-GH', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Payment method</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                      {methodLabel(sale.payment_method)}
                    </Text>
                  </View>
                  {sale.customer_phone && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Customer MoMo</Text>
                      <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>
                        {sale.customer_phone}
                      </Text>
                    </View>
                  )}
                  {Number(sale.balance_due) > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Balance due</Text>
                      <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: '#dc2626' }}>
                        {ghc(sale.balance_due)}
                      </Text>
                    </View>
                  )}
                  {sale.credit_due_date && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Credit due date</Text>
                      <Text style={{ fontSize: 12, color: colors.ink }}>{new Date(sale.credit_due_date).toLocaleDateString('en-GH', { day: 'numeric', month: 'long', year: 'numeric' })}</Text>
                    </View>
                  )}
                </View>

                {/* Items */}
                {sale.items.length > 0 && (
                  <View style={{
                    backgroundColor: colors.bg, borderRadius: 12,
                    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
                  }}>
                    <View style={{
                      paddingHorizontal: 12, paddingVertical: 8,
                      borderBottomWidth: 1, borderBottomColor: colors.border,
                      backgroundColor: `${colors.ink}05`,
                    }}>
                      <Text style={{
                        fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold,
                        textTransform: 'uppercase', letterSpacing: 0.7,
                      }}>
                        Items · {sale.items.length}
                      </Text>
                    </View>
                    {sale.items.map((item, i) => (
                      <View
                        key={String(item.id)}
                        style={{
                          flexDirection: 'row', alignItems: 'center',
                          paddingHorizontal: 12, paddingVertical: 9,
                          borderBottomWidth: i < sale.items.length - 1 ? 1 : 0,
                          borderBottomColor: colors.border,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, color: colors.ink }}>{item.description}</Text>
                          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.mono }}>
                            {ghc(item.unit_price)} × {Number(item.qty)}
                          </Text>
                        </View>
                        <Text style={{
                          fontSize: 13, fontFamily: fonts.displaySemiBold,
                          color: isVoided ? colors.muted : colors.ink,
                          textDecorationLine: isVoided ? 'line-through' : 'none',
                        }}>
                          {ghc(item.line_total)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {/* Totals */}
                <View style={{
                  backgroundColor: colors.bg, borderRadius: 12,
                  borderWidth: 1, borderColor: colors.border, padding: 12, gap: 5,
                }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Subtotal</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>
                      {ghc(sale.subtotal)}
                    </Text>
                  </View>
                  {Number(sale.tax_amount) > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Tax (VAT + levies)</Text>
                      <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.muted }}>
                        {ghc(sale.tax_amount)}
                      </Text>
                    </View>
                  )}
                  {Number(sale.discount_amount) > 0 && (
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>Discount</Text>
                      <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: '#065f46' }}>
                        -{ghc(sale.discount_amount)}
                      </Text>
                    </View>
                  )}
                  <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 3 }} />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Total</Text>
                    <Text style={{
                      fontSize: 14, fontFamily: fonts.displaySemiBold,
                      color: isVoided ? colors.muted : colors.ink,
                      textDecorationLine: isVoided ? 'line-through' : 'none',
                    }}>
                      {ghc(sale.total)}
                    </Text>
                  </View>
                </View>

                {/* Retry MoMo */}
                {sale.payment_method === 'credit' && Number(sale.balance_due) > 0 && (
                  <View style={{ backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 8 }}>
                    <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold }}>Collect repayment</Text>
                    <TextInput value={repaymentAmount} onChangeText={setRepaymentAmount} keyboardType="decimal-pad" placeholder={`Amount up to ${ghc(sale.balance_due)}`} placeholderTextColor={colors.muted} style={{ height: 42, borderWidth: 1, borderColor: colors.border, borderRadius: 9, paddingHorizontal: 10, color: colors.ink }} />
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TouchableOpacity onPress={() => recordCreditPayment.mutate({ sale_id: String(sale.id), amount: Number(repaymentAmount), payment_method: 'cash' }, { onSuccess: () => setRepaymentAmount(''), onError: (e: Error) => Alert.alert('Payment not recorded', e.message) })} style={{ flex: 1, height: 42, borderRadius: 9, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff' }}>Record manual payment</Text></TouchableOpacity>
                      <TouchableOpacity onPress={() => createRepaymentIntent.mutate({ sale_id: String(sale.id), amount: Number(repaymentAmount), idempotency_key: `credit-${Date.now()}` }, { onSuccess: (intent) => intent.payment_url && Share.share({ message: intent.payment_url }), onError: (e: Error) => Alert.alert('Paystack link not created', e.message) })} style={{ flex: 1, height: 42, borderRadius: 9, borderWidth: 1, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: colors.brand }}>Create Paystack payment</Text></TouchableOpacity>
                    </View>
                  </View>
                )}

                {/* Retry MoMo */}
                {retryable && (
                  <TouchableOpacity
                    disabled={retry.isPending}
                    onPress={() =>
                      Alert.alert(
                        'Resend MoMo request',
                        `Re-send GH₵ ${Number(sale.total).toFixed(2)} to ${sale.customer_phone ?? 'customer'}?`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Resend',
                            onPress: () =>
                              retry.mutate(String(sale.id), {
                                onSuccess: (r) => Alert.alert('Sent', r.message),
                                onError: (e: Error) => Alert.alert('Error', e.message),
                              }),
                          },
                        ]
                      )
                    }
                    style={{
                      height: 46, borderRadius: 12,
                      backgroundColor: `${colors.brand}15`,
                      borderWidth: 1, borderColor: colors.brand,
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      opacity: retry.isPending ? 0.6 : 1,
                    }}
                  >
                    {retry.isPending
                      ? <ActivityIndicator size="small" color={colors.brand} />
                      : (
                        <>
                          <MaterialCommunityIcons name="send-outline" size={16} color={colors.brand} />
                          <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                            Resend MoMo request
                          </Text>
                        </>
                      )
                    }
                  </TouchableOpacity>
                )}

                {/* Void */}
                {!isVoided && sale.status === 'paid' && (
                  <TouchableOpacity
                    disabled={voidSaleMut.isPending}
                    onPress={() =>
                      Alert.alert('Void sale?', 'This will reverse the sale and cannot be undone.', [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Void',
                          style: 'destructive',
                          onPress: () => voidSaleMut.mutate(String(sale.id), { onSuccess: onClose }),
                        },
                      ])
                    }
                    style={{
                      height: 44, borderRadius: 12,
                      borderWidth: 1, borderColor: '#dc2626',
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                      opacity: voidSaleMut.isPending ? 0.5 : 1,
                    }}
                  >
                    <MaterialCommunityIcons name="cancel" size={16} color="#dc2626" />
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#dc2626' }}>
                      Void this sale
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
