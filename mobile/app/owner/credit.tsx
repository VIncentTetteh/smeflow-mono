import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { type LoanProduct } from '@/api/credit.api';
import { Text } from '@/components/ui/Text';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import {
  buildCreditInsights,
  buildLoanEmptyState,
  isLoanActionOnlineOnly,
  type CreditDisplayFactor,
} from '@/features/creditInsights';
import { useTheme } from '@/lib/theme';
import { useActiveLenders, useBillingWorkspace, useConfirmLoan, useCreditRequests, useCreditScore, useLoan, useLoanSchedule, useRequestLoan, useResendLoanConfirmation } from '@/api/hooks/featureHooks';

const MAX_SCORE = 100;

const LOAN_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending_partner: { label: 'Awaiting Lender', color: '#b6831e', bg: '#fff5cc' },
  approved:        { label: 'Approved',         color: '#2eb585', bg: '#e6f7f1' },
  rejected:        { label: 'Rejected',         color: '#b8351c', bg: '#fdecea' },
  confirmed:       { label: 'Confirmed',        color: '#1a73e8', bg: '#e8f0fe' },
  disbursing:      { label: 'Disbursing',       color: '#d4a23a', bg: '#fff5cc' },
  active:          { label: 'Active',           color: '#2eb585', bg: '#e6f7f1' },
  repaid:          { label: 'Repaid',           color: '#5c6b7a', bg: '#f0f3f5' },
  defaulted:       { label: 'Defaulted',        color: '#b8351c', bg: '#fdecea' },
  cancelled:       { label: 'Cancelled',        color: '#5c6b7a', bg: '#f0f3f5' },
};

const INSTALMENT_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: 'Due',        color: '#b6831e', bg: '#fff5cc' },
  collecting: { label: 'Processing', color: '#1a73e8', bg: '#e8f0fe' },
  paid:       { label: 'Paid',       color: '#2eb585', bg: '#e6f7f1' },
  failed:     { label: 'Failed',     color: '#b8351c', bg: '#fdecea' },
  defaulted:  { label: 'Overdue',    color: '#b8351c', bg: '#fdecea' },
};

export default function CreditScreen() {
  const { colors, fonts } = useTheme();
  const billing = useBillingWorkspace();
  const creditAllowed = billing.isError ? true : billing.data?.planUsage?.limits?.credit_scoring === true;
  const creditReady = !billing.isLoading && creditAllowed;
  const { data: scoreData, isLoading: scoreLoading } = useCreditScore(creditReady);
  const { data: requests } = useCreditRequests(creditReady);
  const lendersQuery = useActiveLenders(creditReady);
  const lenders = lendersQuery.data ?? [];
  const applyLoan = useRequestLoan();

  const [selectedLender, setSelectedLender] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<LoanProduct | null>(null);
  const [loanAmt, setLoanAmt] = useState('8500');
  const [loanTerm, setLoanTerm] = useState('180');
  const [showModal, setShowModal] = useState(false);
  const [selectedLoanId, setSelectedLoanId] = useState<string | null>(null);
  const [showOtpInput, setShowOtpInput] = useState(false);
  const [otpValue, setOtpValue] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const { data: loanDetail } = useLoan(creditReady ? selectedLoanId : null);
  const { data: loanSchedule = [] } = useLoanSchedule(creditReady ? selectedLoanId : null);
  const confirmLoan = useConfirmLoan();
  const resendConfirm = useResendLoanConfirmation();

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    void NetInfo.fetch().then((state) => {
      setIsOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
    });
    return unsubscribe;
  }, []);

  const insights = buildCreditInsights(scoreData);
  const score = insights.score;
  const loanEmpty = buildLoanEmptyState({ isOnline, score, lendersCount: lenders.length });
  const loansBlockedOffline = isLoanActionOnlineOnly(isOnline);

  function barColor(v: number) {
    if (v >= 80) return colors.brand;
    if (v >= 60) return colors.gold;
    return colors.danger;
  }

  function handleSubmitLoan() {
    if (!selectedLender) return;
    if (loansBlockedOffline) {
      Alert.alert('Internet required', 'Loan applications cannot be queued offline. Reconnect and try again.');
      return;
    }
    const amount = Number(loanAmt);
    const term = Number(loanTerm);
    if (!Number.isFinite(amount) || !Number.isFinite(term) || amount <= 0 || term <= 0) {
      Alert.alert('Check application', 'Enter a valid amount and term before submitting.');
      return;
    }
    if (selectedProduct) {
      if (amount < selectedProduct.min_amount_ghs || amount > selectedProduct.max_amount_ghs) {
        Alert.alert('Amount outside product range', `Enter an amount between GH₵ ${selectedProduct.min_amount_ghs.toLocaleString()} and GH₵ ${selectedProduct.max_amount_ghs.toLocaleString()}.`);
        return;
      }
      if (term < selectedProduct.min_term_days || term > selectedProduct.max_term_days) {
        Alert.alert('Term outside product range', `Enter a term between ${selectedProduct.min_term_days} and ${selectedProduct.max_term_days} days.`);
        return;
      }
    }
    applyLoan.mutate(
      {
        amount_requested: amount,
        term_days: term,
        target_lender_id: selectedLender,
        loan_product_id: selectedProduct?.id ?? undefined,
      },
      {
        onSuccess: () => {
          setShowModal(false);
          setSelectedLender(null);
          setSelectedProduct(null);
          Alert.alert('Applied', 'Your loan request has been submitted to the selected lender.');
        },
        onError: (e: Error) => Alert.alert('Error', e.message),
      }
    );
  }

  const creditBand: string = scoreData?.band ?? '';
  const BAND_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 };
  function isBandEligible(minBand: string) {
    return (BAND_ORDER[creditBand] ?? 4) <= (BAND_ORDER[minBand] ?? 2);
  }

  function renderFactor(f: CreditDisplayFactor, i: number, total: number) {
    return (
      <View key={f.key} style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: i < total - 1 ? 1 : 0, borderBottomColor: colors.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12.5, color: colors.ink, fontFamily: fonts.bodySemiBold }}>{f.label}</Text>
            <Text style={{ fontSize: 10.5, color: colors.muted, marginTop: 1, lineHeight: 14 }}>{f.explanation}</Text>
          </View>
          <Text style={{ fontSize: 11.5, color: colors.muted, fontFamily: fonts.mono, flexShrink: 0 }}>{f.displayValue}</Text>
        </View>
        <View style={{ height: 4, borderRadius: 999, backgroundColor: `${colors.ink}10`, overflow: 'hidden' }}>
          <View style={{ width: `${f.score}%` as never, height: '100%' as never, backgroundColor: barColor(f.score) }} />
        </View>
      </View>
    );
  }

  if (billing.isLoading || scoreLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator color={colors.brand} size="large" />
      </SafeAreaView>
    );
  }

  if (!creditAllowed) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
        <View style={{
          paddingHorizontal: 16, paddingVertical: 12,
          borderBottomWidth: 1, borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Credit & Loans</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>Verified lending partners and score insights</Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16 }}>
          <UpgradePrompt
            feature="Credit scoring"
            requiredPlan="starter"
            description="Starter unlocks SMEFlow score insights and lender matching for this business."
          />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Credit & Loans</Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>Verified lending partners and score insights</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
        {/* Score card — dark */}
        <View style={{ backgroundColor: colors.ink, borderRadius: 16, padding: 16, overflow: 'hidden' }}>
          <View style={{ position: 'absolute', top: -20, right: -20, width: 140, height: 140, borderRadius: 70, backgroundColor: 'rgba(212,162,58,0.2)' }} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ fontSize: 11, color: 'rgba(245,239,225,0.6)', fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8 }}>
              SMEFlow Score
            </Text>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: '#fff5cc' }}>
              <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>{insights.bandLabel}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 48, color: '#f5efe1', letterSpacing: -1.5, lineHeight: 52 }}>{score}</Text>
            <Text style={{ fontSize: 13, color: 'rgba(245,239,225,0.5)' }}>/ {MAX_SCORE}</Text>
          </View>
          {/* Gauge */}
          <View style={{ marginTop: 12, height: 8, borderRadius: 999, backgroundColor: 'rgba(245,239,225,0.12)', overflow: 'hidden' }}>
            <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, flexDirection: 'row' }}>
              <View style={{ flex: 1, backgroundColor: '#b8351c', opacity: 0.85 }} />
              <View style={{ flex: 1, backgroundColor: '#d4a23a', opacity: 0.85 }} />
              <View style={{ flex: 1, backgroundColor: '#2eb585', opacity: 0.85 }} />
            </View>
            <View style={{
              position: 'absolute', top: -3,
              left: `${(score / MAX_SCORE) * 100}%` as never,
              marginLeft: -7, width: 14, height: 14, borderRadius: 7,
              backgroundColor: '#fff', borderWidth: 3, borderColor: colors.ink,
            }} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
            {['POOR', 'FAIR', 'GOOD', 'STRONG'].map((l) => (
              <Text key={l} style={{ fontSize: 9.5, color: 'rgba(245,239,225,0.4)', fontFamily: fonts.bodySemiBold }}>{l}</Text>
            ))}
          </View>
          <Text style={{ marginTop: 12, fontSize: 11.5, lineHeight: 16, color: 'rgba(245,239,225,0.72)' }}>
            {insights.maxLoanAmount > 0
              ? `Estimated loan readiness up to GH₵ ${insights.maxLoanAmount.toLocaleString('en-GH', { maximumFractionDigits: 0 })}. Final approval depends on lender review.`
              : 'Keep recording verified sales and repayments to unlock loan offers.'}
          </Text>
        </View>

        {/* Factors */}
        {insights.displayFactors.length > 0 && (
          <>
            <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>Score factors</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {insights.displayFactors.map((f, i) => renderFactor(f, i, insights.displayFactors.length))}
            </View>
          </>
        )}

        {insights.improvementActions.length > 0 && (
          <>
            <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>Next best actions</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {insights.improvementActions.map((action, i) => (
                <View key={action.title} style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: i < insights.improvementActions.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                  <MaterialCommunityIcons name="arrow-up-circle-outline" size={18} color={colors.brand} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{action.title}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 15, marginTop: 1 }}>{action.body}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Existing loan requests */}
        {requests && requests.length > 0 && (
          <>
            <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>Your requests</Text>
            <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
              {requests.map((req, i) => (
                <TouchableOpacity key={req.id} onPress={() => setSelectedLoanId(req.id)} style={{
                  paddingHorizontal: 12, paddingVertical: 10,
                  borderBottomWidth: i < requests.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                  flexDirection: 'row', alignItems: 'center',
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>GH₵ {Number(req.amount_requested).toLocaleString()}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{req.term_days}-day term · tap for details</Text>
                  </View>
                  {(() => {
                    const s = LOAN_STATUS[req.status] ?? { label: req.status, color: '#5c6b7a', bg: '#f0f3f5' };
                    return (
                      <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: s.bg }}>
                        <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: s.color }}>{s.label}</Text>
                      </View>
                    );
                  })()}
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        {/* Loan partners + products */}
        <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>Loan partners</Text>

        {!isOnline || lenders.length === 0 || lendersQuery.isError ? (
          <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <MaterialCommunityIcons name={!isOnline ? 'wifi-off' : 'bank-off-outline'} size={20} color={colors.muted} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                  {lendersQuery.isError ? 'Could not load lending partners' : loanEmpty.title}
                </Text>
                <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 16, marginTop: 2 }}>
                  {lendersQuery.isError ? 'Check your internet connection and try again.' : loanEmpty.body}
                </Text>
              </View>
            </View>
          </View>
        ) : (
          lenders.map((l) => (
            <View key={l.lender_id} style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 4 }}>
              {/* Lender header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: l.products.length > 0 ? 1 : 0, borderBottomColor: colors.border }}>
                <View style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: `${colors.ink}0f`, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13, color: colors.ink }}>{l.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{l.name}</Text>
                  <Text style={{ fontSize: 11, color: colors.muted }}>{l.products.length > 0 ? `${l.products.length} product${l.products.length > 1 ? 's' : ''}` : 'No products yet'}</Text>
                </View>
              </View>

              {/* Product cards */}
              {l.products.map((product, pi) => {
                const eligible = isBandEligible(product.min_credit_band);
                return (
                  <View key={product.id} style={{
                    paddingHorizontal: 12, paddingVertical: 10,
                    borderBottomWidth: pi < l.products.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                  }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                      <View style={{ flex: 1, marginRight: 8 }}>
                        <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{product.name}</Text>
                        {product.description ? (
                          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{product.description}</Text>
                        ) : null}
                      </View>
                      <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: eligible ? `${colors.brand}15` : `${colors.danger}12` }}>
                        <Text style={{ fontSize: 9.5, fontFamily: fonts.bodySemiBold, color: eligible ? colors.brand : colors.danger }}>
                          Band {product.min_credit_band}+
                        </Text>
                      </View>
                    </View>

                    <View style={{ flexDirection: 'row', gap: 12, marginBottom: 6 }}>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{product.interest_rate_annual}%</Text> p.a.
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        GHS <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{product.min_amount_ghs.toLocaleString()}–{product.max_amount_ghs.toLocaleString()}</Text>
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        <Text style={{ fontFamily: fonts.bodySemiBold, color: colors.ink }}>{product.min_term_days}–{product.max_term_days}</Text> days
                      </Text>
                    </View>

                    {eligible ? (
                      <TouchableOpacity
                        onPress={() => {
                          if (loansBlockedOffline) {
                            Alert.alert('Internet required', 'Loan applications cannot be queued offline. Reconnect and try again.');
                            return;
                          }
                          setSelectedLender(l.lender_id);
                          setSelectedProduct(product);
                          setLoanAmt(String(Math.min(product.max_amount_ghs, Number(scoreData?.max_loan_amount ?? product.max_amount_ghs))));
                          setLoanTerm(String(product.min_term_days));
                          setShowModal(true);
                        }}
                        disabled={loansBlockedOffline}
                        style={{ alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8, backgroundColor: colors.brand, opacity: loansBlockedOffline ? 0.55 : 1 }}
                      >
                        <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: '#fff' }}>{loansBlockedOffline ? 'Online required' : 'Apply →'}</Text>
                      </TouchableOpacity>
                    ) : (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                        <MaterialCommunityIcons name="lock-outline" size={13} color={colors.muted} />
                        <Text style={{ fontSize: 11.5, color: colors.muted }}>Improve your score to apply</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          ))
        )}

        {/* Consent */}
        <View style={{ backgroundColor: `${colors.ink}06`, borderRadius: 14, padding: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <MaterialCommunityIcons name="shield-outline" size={18} color={colors.muted} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Your data, your rules</Text>
              <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 2, lineHeight: 17 }}>
                Only anonymized score factors are shared after you choose a lender. You can revoke access anytime.
              </Text>
              <TouchableOpacity style={{ marginTop: 4 }} onPress={() => Alert.alert('Lender consent', 'Dedicated lender consent management is coming next. For now, consent is only granted when you apply to a specific lender.')}>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.bodySemiBold, color: colors.brand }}>How consent works →</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </ScrollView>

      {/* Loan detail modal */}
      <Modal visible={!!selectedLoanId} transparent animationType="slide" onRequestClose={() => setSelectedLoanId(null)}>
        <View style={{ flex: 1 }}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setSelectedLoanId(null)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34, maxHeight: '75%' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ flex: 1, fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink }}>Loan Details</Text>
              <TouchableOpacity onPress={() => setSelectedLoanId(null)}>
                <MaterialCommunityIcons name="close" size={22} color={colors.muted} />
              </TouchableOpacity>
            </View>

            {loanDetail ? (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View style={{ gap: 7, marginBottom: 14 }}>
                  {(() => {
                    const st = LOAN_STATUS[loanDetail.status] ?? { label: loanDetail.status, color: '#5c6b7a', bg: '#f0f3f5' };
                    return (
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, color: colors.muted }}>Status</Text>
                        <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: st.bg }}>
                          <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: st.color }}>{st.label}</Text>
                        </View>
                      </View>
                    );
                  })()}
                  {[
                    { label: 'Amount', value: `GH₵ ${Number(loanDetail.amount_requested).toLocaleString()}` },
                    loanDetail.amount_approved ? { label: 'Approved', value: `GH₵ ${Number(loanDetail.amount_approved).toLocaleString()}` } : null,
                    { label: 'Term', value: loanDetail.term_days ? `${loanDetail.term_days} days` : '—' },
                    loanDetail.interest_rate ? { label: 'Rate', value: `${loanDetail.interest_rate}% p.a.` } : null,
                    { label: 'Applied', value: loanDetail.requested_at ? new Date(loanDetail.requested_at).toLocaleDateString('en-GH') : '—' },
                    loanDetail.confirmed_at ? { label: 'Confirmed', value: new Date(loanDetail.confirmed_at).toLocaleDateString('en-GH') } : null,
                    loanDetail.decided_at ? { label: 'Decided', value: new Date(loanDetail.decided_at).toLocaleDateString('en-GH') } : null,
                    loanDetail.disbursed_at ? { label: 'Disbursed', value: new Date(loanDetail.disbursed_at).toLocaleDateString('en-GH') } : null,
                    loanDetail.disbursement_phone ? { label: 'Sent to', value: loanDetail.disbursement_phone } : null,
                    loanDetail.partner_ref ? { label: 'Ref', value: loanDetail.partner_ref } : null,
                  ].filter(Boolean).map((row) => (
                    <View key={(row as {label:string}).label} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 12, color: colors.muted }}>{(row as {label:string;value:string}).label}</Text>
                      <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{(row as {label:string;value:string}).value}</Text>
                    </View>
                  ))}
                  {loanDetail.rejection_reason && (
                    <View style={{ backgroundColor: `${colors.danger}10`, borderRadius: 8, padding: 10, marginTop: 4 }}>
                      <Text style={{ fontSize: 11, color: colors.danger, fontFamily: fonts.bodySemiBold, marginBottom: 2 }}>Rejection Reason</Text>
                      <Text style={{ fontSize: 12, color: colors.danger }}>{loanDetail.rejection_reason}</Text>
                    </View>
                  )}
                </View>

                {loanSchedule.length > 0 && (
                  <>
                    <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 }}>
                      Repayment Schedule
                    </Text>
                    <View style={{ backgroundColor: colors.bg, borderRadius: 10, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: 14 }}>
                      {loanSchedule.slice(0, 6).map((inst, i: number) => (
                        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderBottomWidth: i < Math.min(loanSchedule.length, 6) - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                          <Text style={{ flex: 1, fontSize: 11.5, color: colors.muted }}>
                            {inst.due_date ? new Date(inst.due_date).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' }) : `Payment ${(inst.instalment_number ?? i) + 1}`}
                          </Text>
                          <Text style={{ fontSize: 12, fontFamily: fonts.mono, color: colors.ink }}>GH₵ {Number(inst.amount ?? 0).toLocaleString()}</Text>
                          {(() => {
                            const is = INSTALMENT_STATUS[inst.status ?? 'pending'] ?? { label: inst.status ?? 'due', color: '#b6831e', bg: '#fff5cc' };
                            return (
                              <View style={{ marginLeft: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: is.bg }}>
                                <Text style={{ fontSize: 9, fontFamily: fonts.bodySemiBold, color: is.color }}>{is.label}</Text>
                              </View>
                            );
                          })()}
                        </View>
                      ))}
                    </View>
                  </>
                )}

                {loanDetail.status === 'approved' && (
                  <View style={{ gap: 8 }}>
                    <View style={{ backgroundColor: `${colors.brand}10`, borderRadius: 10, padding: 12 }}>
                      <Text style={{ fontSize: 12, color: colors.brand, fontFamily: fonts.bodySemiBold }}>
                        An OTP has been sent to your phone to confirm this loan.
                      </Text>
                    </View>
                    {showOtpInput && (
                      <View>
                        <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>ENTER OTP CODE</Text>
                        <TextInput
                          value={otpValue}
                          onChangeText={setOtpValue}
                          keyboardType="number-pad"
                          placeholder="6-digit code"
                          maxLength={8}
                          placeholderTextColor={colors.muted}
                          style={{
                            borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                            paddingHorizontal: 12, paddingVertical: 10,
                            fontSize: 20, color: colors.ink, backgroundColor: colors.bg,
                            letterSpacing: 4, textAlign: 'center',
                          }}
                        />
                      </View>
                    )}
	                    <View style={{ flexDirection: 'row', gap: 8 }}>
	                      {showOtpInput ? (
                        <TouchableOpacity
                          onPress={() => {
                            if (loansBlockedOffline) {
                              Alert.alert('Internet required', 'Loan confirmation requires a live connection.');
                              return;
                            }
                            if (!selectedLoanId || !otpValue.trim()) return;
                            confirmLoan.mutate(
                              { loanId: selectedLoanId, body: { otp: otpValue.trim() } },
                              {
                                onSuccess: () => { setSelectedLoanId(null); setOtpValue(''); setShowOtpInput(false); Alert.alert('Confirmed', 'Loan confirmed. Disbursement in progress.'); },
                                onError: (e: Error) => Alert.alert('Invalid OTP', e.message),
                              }
                            );
                          }}
                          disabled={confirmLoan.isPending || !otpValue.trim() || loansBlockedOffline}
                          style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', opacity: (confirmLoan.isPending || !otpValue.trim() || loansBlockedOffline) ? 0.6 : 1 }}
                        >
                          {confirmLoan.isPending ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Confirm Loan</Text>}
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={() => setShowOtpInput(true)}
                          style={{ flex: 1, height: 44, borderRadius: 10, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fff' }}>Accept Loan</Text>
                        </TouchableOpacity>
	                      )}
	                      <TouchableOpacity
                        onPress={() => {
                          if (loansBlockedOffline) {
                            Alert.alert('Internet required', 'OTP resend requires a live connection.');
                            return;
                          }
                          if (selectedLoanId) resendConfirm.mutate(selectedLoanId, { onSuccess: () => Alert.alert('Sent', 'OTP resent to your phone.') });
                        }}
                        style={{ paddingHorizontal: 14, height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.muted }}>Resend OTP</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </ScrollView>
            ) : (
              <ActivityIndicator color={colors.brand} style={{ marginVertical: 24 }} />
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowModal(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 4 }}>Loan Application</Text>
            {selectedProduct ? (
              <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 14 }}>
                {selectedProduct.name} · {selectedProduct.interest_rate_annual}% p.a. · {selectedProduct.min_term_days}–{selectedProduct.max_term_days} days
              </Text>
            ) : <View style={{ height: 14 }} />}

            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>
              AMOUNT (GH₵){selectedProduct ? ` · ${selectedProduct.min_amount_ghs.toLocaleString()}–${selectedProduct.max_amount_ghs.toLocaleString()}` : ''}
            </Text>
            <TextInput
              value={loanAmt}
              onChangeText={setLoanAmt}
              keyboardType="numeric"
              placeholder="8500"
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 15, color: colors.ink,
                backgroundColor: colors.bg, marginBottom: 12,
              }}
            />

            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>
              TERM (DAYS){selectedProduct ? ` · ${selectedProduct.min_term_days}–${selectedProduct.max_term_days}` : ''}
            </Text>
            <TextInput
              value={loanTerm}
              onChangeText={setLoanTerm}
              keyboardType="numeric"
              placeholder="180"
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 15, color: colors.ink,
                backgroundColor: colors.bg, marginBottom: 16,
              }}
            />

            <TouchableOpacity
              onPress={handleSubmitLoan}
              disabled={applyLoan.isPending || !loanAmt || !loanTerm || loansBlockedOffline}
              style={{
                height: 46, borderRadius: 12, backgroundColor: colors.brand,
                alignItems: 'center', justifyContent: 'center',
                opacity: (applyLoan.isPending || !loanAmt || !loanTerm || loansBlockedOffline) ? 0.6 : 1,
              }}
            >
              {applyLoan.isPending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>{loansBlockedOffline ? 'Internet required' : 'Submit Application'}</Text>
              }
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
