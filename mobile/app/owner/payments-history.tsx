import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, RefreshControl, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { PAYMENT_PROVIDER_BRAND_COLORS } from '@/components/ui/ProviderChip';
import { useTheme } from '@/lib/theme';
import { useCancelMerchantSettlement, useGenerateGhQR, usePaymentsWorkspace, useRequestMerchantSettlement, useSettlementPreview } from '@/api/hooks/featureHooks';
import { useAddMomoAccount, useProvisionDedicatedAccount, useVerifyMomoAccount } from '@/api/hooks/sessionHooks';
import { useAuthStore } from '@/store/auth';
import type { MerchantLedgerEntryDto, MerchantSettlementDto } from '@/types/settlements';

const PROVIDER_COLORS: Record<string, { bg: string; fg: string }> = {
  mtn:        { bg: PAYMENT_PROVIDER_BRAND_COLORS.mtn, fg: '#1a1208' },
  vodafone:   { bg: PAYMENT_PROVIDER_BRAND_COLORS.vodafone, fg: '#fff' },
  airteltigo: { bg: PAYMENT_PROVIDER_BRAND_COLORS.airteltigo, fg: '#fff' },
};

function providerColor(provider: string) {
  return PROVIDER_COLORS[provider.toLowerCase()] ?? { bg: '#6b6860', fg: '#fff' };
}

function providerLabel(provider: string) {
  const map: Record<string, string> = { mtn: 'MTN', vodafone: 'Telecel', airteltigo: 'AT', at: 'AT' };
  return map[provider.toLowerCase()] ?? provider.toUpperCase().slice(0, 6);
}

function normalizeGhanaPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('233') ? digits.slice(3) : digits.replace(/^0/, '');
  return local.length === 9 ? `+233${local}` : null;
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function signedMoney(value: unknown) {
  const amount = Number(value ?? 0);
  const prefix = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${prefix}${money(Math.abs(amount))}`;
}

function shortDate(value?: string | null) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusColor(
  status: string,
  colors: { brand: string; danger: string; muted: string; ink: string; gold: string }
) {
  const normalized = status.toLowerCase();
  if (['completed', 'paid', 'verified'].includes(normalized)) return colors.brand;
  if (['failed', 'cancelled', 'reversed'].includes(normalized)) return colors.danger;
  if (['processing', 'approved'].includes(normalized)) return colors.gold;
  return colors.muted;
}

type WalletTab = 'ledger' | 'payouts';

const FINAL_PAYMENT_STATUSES = new Set(['success', 'failed', 'reversed', 'cancelled', 'canceled']);

function isProviderCollectedPayment(payment: { type?: string; provider?: string | null; processor?: string | null }) {
  return payment.type === 'collection' && (
    payment.processor === 'paystack' ||
    payment.provider === 'paystack'
  );
}


export default function PaymentsScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const business = useAuthStore((s) => s.business);
  const businessKyc = useAuthStore((s) => s.businessKyc);
  const momoAccounts = useAuthStore((s) => s.momoAccounts);
  const { data: paymentsData, isLoading, isError, refetch } = usePaymentsWorkspace();
  const genQR = useGenerateGhQR();
  const addWallet = useAddMomoAccount();
  const verifyWallet = useVerifyMomoAccount();
  const provisionDva = useProvisionDedicatedAccount();
  const requestSettlement = useRequestMerchantSettlement();
  const cancelSettlement = useCancelMerchantSettlement();

  const [showAddWallet, setShowAddWallet] = useState(false);
  const [showRequestPayout, setShowRequestPayout] = useState(false);
  const [requestAmount, setRequestAmount] = useState('');
  const [walletTab, setWalletTab] = useState<WalletTab>('ledger');
  const [walletPhone, setWalletPhone] = useState('');
  const [walletProvider, setWalletProvider] = useState<'mtn' | 'vodafone' | 'airteltigo'>('mtn');
  const [autoVerifyAttempted, setAutoVerifyAttempted] = useState<Record<string, boolean>>({});

  const settlementBalance = paymentsData?.settlementBalance;
  const settlementLedger = paymentsData?.settlementLedger;
  const settlementHistory = paymentsData?.settlements;
  const reconciliation = paymentsData?.reconciliation;
  const channelAnalytics = paymentsData?.channelAnalytics;
  const paymentRows = paymentsData?.items ?? [];
  const reconciliationItems = reconciliation?.items ?? [];
  const needsReview = reconciliationItems.filter((payment) =>
    ['unmatched', 'suggested_match'].includes(payment.match_state)
  );
  const providerPendingTotal = paymentRows
    .filter((payment) =>
      isProviderCollectedPayment(payment) &&
      !FINAL_PAYMENT_STATUSES.has(String(payment.status ?? '').toLowerCase())
    )
    .reduce((sum, payment) => sum + Number(payment.amount ?? 0), 0);
  const ledgerRows = settlementLedger?.items ?? [];
  const settlementRows = settlementHistory?.items ?? [];
  const pendingSettlement = settlementRows.find((s) => s.status === 'pending');
  const hasDva = !!business?.dva_account_number;
  const kycStatus = String(businessKyc?.status ?? '').toLowerCase();
  const dvaPendingTitle = kycStatus === 'verified' ? 'Provisioning dedicated account' : 'Dedicated account pending';
  const dvaPendingBody = kycStatus === 'verified'
    ? 'KYC is approved. We are waiting for Paystack to assign the bank-transfer account for this business.'
    : 'This appears after business KYC is approved and Paystack provisions the account.';
  const availableBalance = Number(settlementBalance?.unsettled_balance ?? 0);
  const requestedPayoutAmount = Number(requestAmount || 0);
  const collectionFeeRate = Number(settlementBalance?.fee_rate_percent ?? 0);
  const minSettlementAmount = Number(settlementBalance?.min_settlement_ghs ?? 10);
  const autoApproveCeiling = Number(settlementBalance?.auto_approve_ceiling_ghs ?? 5000);

  // Server-computed fee preview — authoritative, updates when amount changes
  const preview = useSettlementPreview(showRequestPayout && requestedPayoutAmount > 0 ? requestedPayoutAmount : null);
  const payoutTransferFee = Number(preview.data?.transfer_fee ?? 0);
  const payoutNetAmount = Number(preview.data?.net_amount ?? Math.max(0, requestedPayoutAmount));
  const previewCanSettle = preview.data?.can_settle ?? (requestedPayoutAmount >= minSettlementAmount && requestedPayoutAmount <= availableBalance);
  const requiresAdminApproval = preview.data?.requires_admin_approval ?? (requestedPayoutAmount > autoApproveCeiling);
  const isRefreshing = Boolean(paymentsData) && isLoading;
  const canRequestPayout = Boolean(
    settlementBalance?.settlement_enabled &&
    availableBalance > 0 &&
    !settlementBalance?.pending_settlement_count
  );
  const verifiedPrimaryWallet = useMemo(
    () => momoAccounts.find((wallet) => wallet.is_primary && (wallet.is_verified || wallet.status === 'verified')),
    [momoAccounts]
  );

  function handlePrint() {
    genQR.mutate({});
  }

  function retryDvaProvisioning() {
    provisionDva.mutate(undefined, {
      onSuccess: (result) => {
        Alert.alert(
          result.provisioned ? 'Dedicated account ready' : 'Setup still pending',
          result.provisioned
            ? 'Your bank-transfer account has been assigned to this business.'
            : result.message || 'Paystack has not assigned an account yet. Try again later or contact support.'
        );
      },
      onError: (e: Error) => Alert.alert('Could not retry setup', e.message),
    });
  }

  function openReconciliationReview() {
    router.push('/owner/reconciliation');
  }

  function openRequestPayout() {
    setRequestAmount(String(settlementBalance?.unsettled_balance ?? ''));
    setShowRequestPayout(true);
  }

  function submitRequestPayout() {
    const amount = Number(requestAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Enter an amount', 'Payout amount must be more than GH₵ 0.');
      return;
    }
    requestSettlement.mutate(
      { amount: amount.toFixed(2) },
      {
        onSuccess: (result) => {
          setShowRequestPayout(false);
          Alert.alert('Payout requested', result.message || 'Your payout request has been submitted.');
        },
        onError: (e: Error) => Alert.alert('Payout unavailable', e.message),
      }
    );
  }

  function handleCancelSettlement(settlement: MerchantSettlementDto) {
    Alert.alert(
      'Cancel payout?',
      'The pending payout will be cancelled and your wallet balance will remain available.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel payout',
          style: 'destructive',
          onPress: () =>
            cancelSettlement.mutate(
              { settlementId: settlement.id, reason: 'Cancelled from mobile app' },
              {
                onSuccess: (result) => Alert.alert('Payout cancelled', result.message),
                onError: (e: Error) => Alert.alert('Could not cancel payout', e.message),
              }
            ),
        },
      ]
    );
  }

  useEffect(() => {
    if (verifyWallet.isPending) return;
    const pending = momoAccounts.find((wallet) =>
      wallet.status !== 'verified' && !autoVerifyAttempted[wallet.id]
    );
    if (!pending) return;
    setAutoVerifyAttempted((current) => ({ ...current, [pending.id]: true }));
    verifyWallet.mutate(pending.id);
  }, [autoVerifyAttempted, momoAccounts, verifyWallet]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Payments</Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>Wallets, payouts & GhQR</Text>
      </View>

      {isLoading && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.brand} size="large" />
        </View>
      )}
      {isError && !isLoading && (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 12 }}>
            Couldn't load wallet data.
          </Text>
          <TouchableOpacity
            onPress={() => void refetch()}
            style={{ paddingVertical: 9, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.ink }}>
            <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>Tap to retry</Text>
          </TouchableOpacity>
        </View>
      )}
      {!isLoading && !isError && (
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refetch()} />}
      >
        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Settlement wallet
        </Text>
        <View style={{ backgroundColor: colors.ink, borderRadius: 16, padding: 16, marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: 'rgba(253,247,235,0.58)', fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                Held by SMEFlow
              </Text>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 30, color: '#fdf7eb', marginTop: 4 }}>
                {money(settlementBalance?.unsettled_balance)}
              </Text>
              <Text style={{ fontSize: 11.5, color: 'rgba(253,247,235,0.62)', marginTop: 4 }}>
                Available to withdraw from successful online collections
              </Text>
              <Text style={{ fontSize: 11.5, color: 'rgba(253,247,235,0.62)', marginTop: 2 }}>
                {settlementBalance?.settlement_enabled ? 'Auto-settlement active' : 'Settlements paused'}
                {settlementBalance?.pending_settlement_count ? ` · ${settlementBalance.pending_settlement_count} payout in progress` : ''}
              </Text>
            </View>
            <TouchableOpacity
              disabled={!canRequestPayout}
              onPress={openRequestPayout}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 9,
                borderRadius: 10,
                backgroundColor: colors.gold,
                opacity: canRequestPayout ? 1 : 0.5,
              }}
            >
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink }}>Request payout</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
            {[
              ['Settled', money(settlementBalance?.total_settled)],
              ['Threshold', money(settlementBalance?.settlement_threshold)],
              ['Next auto', shortDate(settlementBalance?.next_auto_settlement_date)],
            ].map(([label, value]) => (
              <View key={label} style={{ flex: 1, borderRadius: 10, backgroundColor: 'rgba(253,247,235,0.08)', padding: 10 }}>
                <Text style={{ fontSize: 10.5, color: 'rgba(253,247,235,0.58)' }}>{label}</Text>
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: '#fdf7eb', marginTop: 3 }} numberOfLines={1}>
                  {value || 'Pending'}
                </Text>
              </View>
            ))}
          </View>
          {!verifiedPrimaryWallet ? (
            <Text style={{ fontSize: 11.5, color: 'rgba(253,247,235,0.68)', marginTop: 12 }}>
              Link and verify a primary MoMo wallet before requesting payouts.
            </Text>
          ) : null}
          <Text style={{ fontSize: 11, color: 'rgba(253,247,235,0.56)', marginTop: verifiedPrimaryWallet ? 12 : 6 }}>
            Cash and manual payments are recorded in reports, but are not held here for payout.
          </Text>
        </View>

        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Funds movement
        </Text>
        <View style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 12,
          marginBottom: 18,
          gap: 10,
        }}>
          {[
            ['Available for payout', money(settlementBalance?.unsettled_balance)],
            ['Provider pending', money(providerPendingTotal)],
            ['Settled to wallet', money(settlementBalance?.total_settled)],
            ['Manual sales not held', 'Shown in Sales reports'],
          ].map(([label, value]) => (
            <View key={label} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontSize: 12, color: colors.muted, flex: 1 }}>{label}</Text>
              <Text
                style={{
                  fontSize: 12,
                  fontFamily: label === 'Manual sales not held' ? fonts.bodySemiBold : fonts.displaySemiBold,
                  color: label === 'Provider pending' && providerPendingTotal > 0 ? '#7a5a14' : colors.ink,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {value}
              </Text>
            </View>
          ))}
          <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 16 }}>
            A sale appears in Sales immediately. It reaches this wallet only after Paystack confirms that SMEFlow is holding the money.
          </Text>
        </View>

        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Bank transfer account
        </Text>
        <View style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 12,
          marginBottom: 18,
          gap: 8,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 34,
              height: 34,
              borderRadius: 9,
              backgroundColor: hasDva ? `${colors.brand}1a` : colors.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="bank-outline" size={18} color={hasDva ? colors.brand : colors.muted} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                {hasDva ? (business?.dva_bank_name || 'Dedicated account') : dvaPendingTitle}
              </Text>
              <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>
                {hasDva ? 'Customers can pay by bank transfer into this account.' : dvaPendingBody}
              </Text>
            </View>
          </View>
          {hasDva ? (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Account number</Text>
                <Text style={{ color: colors.ink, fontFamily: fonts.mono, fontSize: 13 }}>{business?.dva_account_number}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ color: colors.muted, fontSize: 12 }}>Account name</Text>
                <Text style={{ color: colors.ink, fontFamily: fonts.bodySemiBold, fontSize: 12, flex: 1, textAlign: 'right' }} numberOfLines={1}>
                  {business?.dva_account_name || business?.name}
                </Text>
              </View>
            </View>
          ) : kycStatus === 'verified' ? (
            <TouchableOpacity
              onPress={retryDvaProvisioning}
              disabled={provisionDva.isPending}
              style={{
                alignSelf: 'flex-start',
                marginTop: 4,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                backgroundColor: colors.ink,
                opacity: provisionDva.isPending ? 0.6 : 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {provisionDva.isPending ? (
                <ActivityIndicator size="small" color="#fdf7eb" />
              ) : (
                <MaterialCommunityIcons name="refresh" size={15} color="#fdf7eb" />
              )}
              <Text style={{ color: '#fdf7eb', fontFamily: fonts.bodySemiBold, fontSize: 12 }}>Retry setup</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
          {([
            ['ledger', 'Transactions'],
            ['payouts', 'Payout history'],
          ] as const).map(([tab, label]) => {
            const active = walletTab === tab;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setWalletTab(tab)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 11,
                  borderWidth: 1,
                  borderColor: active ? colors.ink : colors.border,
                  backgroundColor: active ? `${colors.ink}0a` : colors.surface,
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: active ? colors.ink : colors.muted }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {walletTab === 'ledger' ? (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
            {ledgerRows.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', padding: 14 }}>No wallet transactions yet.</Text>
            ) : ledgerRows.map((entry: MerchantLedgerEntryDto, index: number) => {
              const signed = Number(entry.amount ?? 0);
              const positive = signed >= 0;
              return (
                <View key={entry.id} style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  borderBottomWidth: index < ledgerRows.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}>
                  <View style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    backgroundColor: positive ? `${colors.brand}1a` : `${colors.danger}12`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name={positive ? 'arrow-down-left' : 'arrow-up-right'} size={16} color={positive ? colors.brand : colors.danger} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink, textTransform: 'capitalize' }}>
                      {entry.type}
                    </Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                      {entry.description || shortDate(entry.created_at)}
                    </Text>
                    <Text style={{ fontSize: 10.5, color: colors.muted, marginTop: 1 }}>
                      Balance {money(entry.balance_after)}
                    </Text>
                  </View>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13.5, color: positive ? colors.brand : colors.danger }}>
                    {signedMoney(entry.amount)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden', marginBottom: 18 }}>
            {settlementRows.length === 0 ? (
              <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', padding: 14 }}>No payout history yet.</Text>
            ) : settlementRows.map((settlement: MerchantSettlementDto, index: number) => {
              const canCancel = settlement.status === 'pending';
              return (
                <View key={settlement.id} style={{
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  borderBottomWidth: index < settlementRows.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  gap: 8,
                }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                        {money(settlement.net_amount)}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                        {shortDate(settlement.requested_at || settlement.created_at)}
                        {settlement.destination_phone ? ` · ${settlement.destination_phone}` : ''}
                      </Text>
                    </View>
                    <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: statusColor(settlement.status, colors), textTransform: 'capitalize' }}>
                      {settlement.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                  {settlement.failure_reason ? (
                    <Text style={{ fontSize: 11, color: colors.danger }}>{settlement.failure_reason}</Text>
                  ) : null}
                  {canCancel ? (
                    <TouchableOpacity
                      disabled={cancelSettlement.isPending}
                      onPress={() => handleCancelSettlement(settlement)}
                      style={{ alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: `${colors.danger}12` }}
                    >
                      <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: colors.danger }}>
                        {cancelSettlement.isPending ? 'Cancelling…' : 'Cancel payout'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}

        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Online payments by channel
        </Text>
        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, marginBottom: 18, gap: 10 }}>
          {(channelAnalytics?.items ?? []).length === 0 ? (
            <Text style={{ fontSize: 12.5, color: colors.muted }}>No successful online collections yet.</Text>
          ) : (
            <>
              <Text style={{ fontSize: 11.5, color: colors.muted }}>
                Successful platform collections before fees. Cash/manual sales stay in sales reports.
              </Text>
              {channelAnalytics?.items.map((item) => (
                <View key={`${item.processor}-${item.channel}-${item.provider_detail ?? ''}`} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{item.channel.replace(/_/g, ' ')}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{item.provider_detail ?? item.processor} · {item.count} payment{item.count === 1 ? '' : 's'}</Text>
                  </View>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 14, color: colors.ink }}>GH₵ {Number(item.total).toLocaleString()}</Text>
                </View>
              ))}
            </>
          )}
        </View>

        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Linked wallets
        </Text>
        <View style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          {momoAccounts.length === 0 ? (
            <View style={{ padding: 12 }}>
              <Text style={{ fontSize: 13, color: colors.muted }}>No MoMo wallet linked yet.</Text>
            </View>
          ) : (
            momoAccounts.map((wallet, index) => {
              const c = providerColor(wallet.provider ?? '');
              return (
                <View
                  key={wallet.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    borderBottomWidth: index < momoAccounts.length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{
                    width: 34, height: 34, borderRadius: 9,
                    backgroundColor: c.bg,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Text style={{ fontSize: 9, fontFamily: fonts.bodySemiBold, color: c.fg }}>
                      {providerLabel(wallet.provider ?? '')}
                    </Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                      {wallet.account_name || providerLabel(wallet.provider ?? '')}
                    </Text>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 11, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
                      {wallet.phone}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 3 }}>
                    {wallet.is_primary ? (
                      <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: colors.brand }}>Primary</Text>
                    ) : null}
                    {wallet.status === 'verified' ? (
                      <Text style={{ fontSize: 10.5, color: '#16834a' }}>Verified</Text>
                    ) : (
                      <TouchableOpacity
                        disabled={verifyWallet.isPending}
                        onPress={() => verifyWallet.mutate(wallet.id, {
                          onError: (e: Error) => Alert.alert('Verification failed', e.message),
                        })}
                        style={{
                          paddingHorizontal: 9,
                          paddingVertical: 4,
                          borderRadius: 8,
                          backgroundColor: `${colors.brand}1a`,
                          opacity: verifyWallet.isPending ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                          {verifyWallet.isPending ? 'Verifying' : 'Verify'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </View>

        <TouchableOpacity
          onPress={() => setShowAddWallet(true)}
          style={{
            width: '100%', paddingVertical: 11, marginBottom: 18, borderRadius: 12,
            borderWidth: 1.5, borderColor: colors.border, borderStyle: 'dashed',
            alignItems: 'center',
          }}>
          <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.muted }}>+ Link another wallet</Text>
        </TouchableOpacity>

        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          Online payment reconciliation
        </Text>
        <View style={{
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 14,
          padding: 12,
          marginBottom: 18,
          gap: 10,
        }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[
              ['Needs review', reconciliation?.summary.unmatched ?? 0],
              ['Suggested', reconciliation?.summary.suggested_match ?? 0],
              ['Linked', reconciliation?.summary.matched ?? 0],
            ].map(([label, count]) => (
              <View key={label} style={{ flex: 1, borderRadius: 10, backgroundColor: colors.bg, padding: 10 }}>
                <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink }}>{count}</Text>
                <Text style={{ fontSize: 10.5, color: colors.muted, marginTop: 1 }}>{label}</Text>
              </View>
            ))}
          </View>

          <Text style={{ fontSize: 11.5, color: colors.muted, lineHeight: 16 }}>
            Match successful online collections to the sale or invoice they paid for. Cash and manual payments are not part of this queue.
          </Text>

          {needsReview.length === 0 ? (
            <Text style={{ fontSize: 12.5, color: colors.muted }}>
              No received payments need review right now.
            </Text>
          ) : (
            needsReview.slice(0, 3).map((payment) => (
              <View
                key={payment.id}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                  gap: 10,
                  paddingTop: 10,
                }}
              >
                <View style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  backgroundColor: providerColor(payment.provider ?? '').bg,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Text style={{ fontSize: 9, fontFamily: fonts.bodySemiBold, color: providerColor(payment.provider ?? '').fg }}>
                    {providerLabel(payment.provider ?? '')}
                  </Text>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {payment.match_state === 'suggested_match' ? 'Suggested match' : 'Needs match'}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                    {payment.phone ?? 'Unknown payer'} · {payment.external_ref ?? 'No reference'}
                  </Text>
                </View>
                <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13.5, color: colors.ink }}>
                  GH₵ {Number(payment.amount).toLocaleString()}
                </Text>
              </View>
            ))
          )}
          {needsReview.length > 0 ? (
            <TouchableOpacity
              onPress={openReconciliationReview}
              style={{
                minHeight: 42,
                borderRadius: 11,
                backgroundColor: colors.ink,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
              }}
            >
              <MaterialCommunityIcons name="playlist-check" size={16} color="#fdf7eb" />
              <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>
                Review payments
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* GhQR */}
        <Text style={{
          fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold,
          textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
        }}>
          GhQR · Accept by scan
        </Text>
        <View style={{
          backgroundColor: colors.ink, borderRadius: 16, padding: 16, marginBottom: 18,
          flexDirection: 'row', gap: 14, alignItems: 'center',
        }}>
          <View style={{
            width: 90, height: 90, borderRadius: 10, backgroundColor: '#fdf7eb',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            {genQR.data?.qr_payload ? (
              <QRCode value={genQR.data.qr_payload} size={78} backgroundColor="#fdf7eb" color="#1a1612" />
            ) : genQR.data?.qr_image_url ? (
              <Image
                source={{ uri: genQR.data.qr_image_url }}
                style={{ width: 78, height: 78, borderRadius: 6 }}
                resizeMode="contain"
              />
            ) : genQR.isPending ? (
              <ActivityIndicator size="small" color="#1a1612" />
            ) : (
              <MaterialCommunityIcons name="qrcode" size={58} color="#1a1612" />
            )}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: 'rgba(253,247,235,0.5)', letterSpacing: 0.8 }}>
              GhQR · MERCHANT
            </Text>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 17, color: '#fdf7eb', marginTop: 2, lineHeight: 20 }}>
              {business?.name ?? 'Your business'}
            </Text>
            <TouchableOpacity
              onPress={handlePrint}
              disabled={genQR.isPending}
              style={{
                marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
                backgroundColor: colors.gold, alignSelf: 'flex-start',
                opacity: genQR.isPending ? 0.6 : 1,
              }}
            >
              <MaterialCommunityIcons name="printer-outline" size={13} color={colors.ink} />
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink }}>
                {genQR.isPending ? 'Generating…' : 'Print'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>

      )}
      <Modal visible={showRequestPayout} transparent animationType="slide" onRequestClose={() => setShowRequestPayout(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowRequestPayout(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 6 }}>Request payout</Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
              Available balance {money(settlementBalance?.unsettled_balance)}. Funds are sent to your verified primary MoMo wallet.
            </Text>

            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>AMOUNT</Text>
            <TextInput
              value={requestAmount}
              onChangeText={setRequestAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 18, color: colors.ink, backgroundColor: colors.bg, marginBottom: 10,
                fontFamily: fonts.displaySemiBold,
              }}
            />

            {verifiedPrimaryWallet ? (
              <View style={{ borderRadius: 10, backgroundColor: colors.bg, padding: 10, marginBottom: 14 }}>
                <Text style={{ fontSize: 11, color: colors.muted }}>Destination</Text>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink, marginTop: 2 }}>
                  {providerLabel(verifiedPrimaryWallet.provider)} · {verifiedPrimaryWallet.phone}
                </Text>
              </View>
            ) : (
              <View style={{ borderRadius: 10, backgroundColor: `${colors.danger}10`, padding: 10, marginBottom: 14 }}>
                <Text style={{ fontSize: 12, color: colors.danger }}>
                  Verify a primary MoMo wallet before requesting a payout.
                </Text>
              </View>
            )}

            <View style={{ borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, padding: 10, marginBottom: 14, gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Requested</Text>
                <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{money(requestedPayoutAmount)}</Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>Payout transfer fee</Text>
                {preview.isLoading && requestedPayoutAmount > 0
                  ? <ActivityIndicator size="small" color={colors.muted} />
                  : <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{money(payoutTransferFee)}</Text>
                }
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <Text style={{ fontSize: 12, color: colors.muted }}>You receive</Text>
                {preview.isLoading && requestedPayoutAmount > 0
                  ? <ActivityIndicator size="small" color={colors.brand} />
                  : <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.brand }}>{money(payoutNetAmount)}</Text>
                }
              </View>
              {requiresAdminApproval && (
                <Text style={{ fontSize: 11, color: colors.gold, lineHeight: 16 }}>
                  This amount exceeds {money(autoApproveCeiling)} and will require admin approval before transfer.
                </Text>
              )}
              {preview.data && !preview.data.can_settle && preview.data.reason && (
                <Text style={{ fontSize: 11, color: colors.danger, lineHeight: 16 }}>
                  {preview.data.reason === 'insufficient_balance'
                    ? `Amount exceeds available balance of ${money(preview.data.unsettled_balance)}.`
                    : `Minimum payout is ${money(minSettlementAmount)}.`}
                </Text>
              )}
              <Text style={{ fontSize: 11, color: colors.muted, lineHeight: 16 }}>
                Platform fee {collectionFeeRate.toFixed(1)}% was deducted when payments entered your wallet. Min payout {money(minSettlementAmount)}.
              </Text>
            </View>

            <TouchableOpacity
              disabled={requestSettlement.isPending || preview.isLoading || !verifiedPrimaryWallet || !previewCanSettle}
              onPress={submitRequestPayout}
              style={{
                height: 46, borderRadius: 12, backgroundColor: colors.brand,
                alignItems: 'center', justifyContent: 'center',
                opacity: (requestSettlement.isPending || preview.isLoading || !verifiedPrimaryWallet || !previewCanSettle) ? 0.6 : 1,
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                {requestSettlement.isPending ? 'Submitting…' : 'Submit payout request'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={showAddWallet} transparent animationType="slide" onRequestClose={() => setShowAddWallet(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowAddWallet(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 14 }}>Link MoMo Wallet</Text>

            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 6 }}>PROVIDER</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {(['mtn', 'vodafone', 'airteltigo'] as const).map((p) => (
                <TouchableOpacity
                  key={p}
                  onPress={() => setWalletProvider(p)}
                  style={{
                    flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center',
                    borderWidth: 1.5,
                    borderColor: walletProvider === p ? colors.ink : colors.border,
                    backgroundColor: walletProvider === p ? `${colors.ink}0a` : colors.bg,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: walletProvider === p ? colors.ink : colors.muted }}>
                    {p === 'mtn' ? 'MTN' : p === 'vodafone' ? 'Telecel' : 'AT'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>PHONE NUMBER</Text>
            <TextInput
              value={walletPhone}
              onChangeText={setWalletPhone}
              keyboardType="phone-pad"
              placeholder="024 000 0000"
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1, borderColor: colors.border, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 10,
                fontSize: 15, color: colors.ink, backgroundColor: colors.bg, marginBottom: 14,
              }}
            />

            <TouchableOpacity
              disabled={addWallet.isPending || walletPhone.length < 9}
              onPress={() => {
                const phone = normalizeGhanaPhone(walletPhone);
                if (!phone) {
                  Alert.alert('Invalid number', 'Enter a valid Ghana MoMo number.');
                  return;
                }
                addWallet.mutate(
                  { provider: walletProvider, phone, account_name: providerLabel(walletProvider), is_primary: momoAccounts.length === 0 },
                  {
                    onSuccess: () => { setShowAddWallet(false); setWalletPhone(''); Alert.alert('Linked', 'Wallet added successfully.'); },
                    onError: (e: Error) => Alert.alert('Error', e.message),
                  }
                );
              }}
              style={{
                height: 46, borderRadius: 12, backgroundColor: colors.brand,
                alignItems: 'center', justifyContent: 'center',
                opacity: (addWallet.isPending || walletPhone.length < 9) ? 0.6 : 1,
              }}
            >
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: '#fff' }}>
                {addWallet.isPending ? 'Linking…' : 'Link wallet'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
