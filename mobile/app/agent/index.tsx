import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAgentTraders, useAgentWalletWorkspace, useAgentWorkspace, useWithdrawAgentWallet } from '@/api/hooks/featureHooks';
import { useAuthStore } from '@/store/auth';

function kycTone(status: string): 'success' | 'warn' | 'danger' | 'neutral' {
  if (status === 'verified' || status === 'approved') return 'success';
  if (status === 'pending' || status === 'submitted') return 'warn';
  if (status === 'rejected' || status === 'failed') return 'danger';
  return 'neutral';
}

function kycLabel(status: string): string {
  if (status === 'verified' || status === 'approved') return 'Verified';
  if (status === 'pending') return 'KYC pending';
  if (status === 'submitted') return 'Under review';
  if (status === 'rejected' || status === 'failed') return 'KYC failed';
  return status;
}

function pillColor(tone: string, colors: ReturnType<typeof useTheme>['colors']) {
  if (tone === 'success') return { bg: `${colors.brand}15`, text: colors.brand };
  if (tone === 'warn')    return { bg: '#fff5cc', text: '#b6831e' };
  if (tone === 'danger')  return { bg: `${colors.danger}15`, text: colors.danger };
  return { bg: `${colors.ink}08`, text: colors.muted };
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return 'Friday';
  return new Date(value).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function AgentScreen() {
  const { colors, fonts } = useTheme();
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  const { data: workspace, isLoading: workspaceLoading } = useAgentWorkspace();
  const { data: tradersData, isLoading: tradersLoading } = useAgentTraders();
  const { data: walletWorkspace, isLoading: walletLoading } = useAgentWalletWorkspace();
  const wallet = walletWorkspace?.wallet;

  const isLoading = workspaceLoading || walletLoading;

  const completed = workspace?.completed ?? workspace?.onboarded_count ?? 0;
  const target = workspace?.target ?? 0;
  const periodCommission = Number(workspace?.period_commission ?? 0);
  const progressPct = target > 0 ? Math.min((completed / target) * 100, 100) : 0;

  // G-M1: show agent name, not phone
  const agentDisplayName = workspace?.name ?? user?.name ?? user?.phone ?? 'Agent';
  const agentInitials = agentDisplayName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase() || 'AG';

  // G-M2: real active status from API
  const isActive = workspace?.is_active !== false;

  // G-M3: dynamic next payout label
  const nextPayoutLabel = shortDate(wallet?.next_payout_date);

  const pipeline = (tradersData ?? []).slice(0, 5);

  const withdraw = useWithdrawAgentWallet();
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const initials = (name: string) => name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      {/* Agent header */}
      <View style={{ paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{
          width: 38, height: 38, borderRadius: 12,
          backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center',
        }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13, color: '#1a1208' }}>{agentInitials}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
            Agent
          </Text>
          {/* G-M1: name not phone */}
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 17, color: colors.ink }}>
            {agentDisplayName}
          </Text>
        </View>
        {/* G-M2: dynamic status badge */}
        <View style={{
          paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999,
          backgroundColor: isActive ? `${colors.brand}15` : `${colors.danger}15`,
        }}>
          <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: isActive ? colors.brand : colors.danger }}>
            {isActive ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, gap: 12 }}>

        {/* G-M5: skeleton while loading */}
        {isLoading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            {/* Performance hero */}
            <View style={{ backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View>
                  <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>This month</Text>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 30, color: colors.ink, marginTop: 2 }}>
                    {completed} {target > 0 ? `/ ${target}` : ''}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.muted }}>traders onboarded</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  {/* G-M4: period_commission directly — no misleading fallback */}
                  <Text style={{ fontSize: 11, color: colors.muted }}>Earned this month</Text>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, color: colors.brand }}>
                    {money(periodCommission)}
                  </Text>
                  {Number(workspace?.total_commission_earned ?? 0) > 0 && (
                    <Text style={{ fontSize: 10, color: colors.muted, marginTop: 2 }}>
                      Total: {money(workspace?.total_commission_earned)}
                    </Text>
                  )}
                </View>
              </View>
              {target > 0 && (
                <>
                  <View style={{ marginTop: 10, height: 6, borderRadius: 999, backgroundColor: `${colors.ink}10`, overflow: 'hidden' }}>
                    <View style={{ width: `${progressPct}%` as never, height: '100%' as never, backgroundColor: colors.brand }} />
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
                    <Text style={{ fontSize: 10.5, color: colors.muted }}>{completed} done</Text>
                    <Text style={{ fontSize: 10.5, color: colors.muted }}>{target - completed} to goal</Text>
                  </View>
                </>
              )}
            </View>

            {/* Wallet */}
            <View style={{ backgroundColor: colors.ink, borderRadius: 16, padding: 14 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}>
                  {/* G-M3: dynamic label */}
                  <Text style={{ fontSize: 11, color: 'rgba(253,247,235,0.58)', fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                    Available for {nextPayoutLabel} payout
                  </Text>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 28, color: '#fdf7eb', marginTop: 3 }}>
                    {money(wallet?.available_balance)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 11, color: 'rgba(253,247,235,0.58)' }}>Next payout</Text>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fdf7eb', marginTop: 4 }}>
                    {nextPayoutLabel}
                  </Text>
                  <Text style={{ fontSize: 10.5, color: wallet?.eligible_for_payout ? colors.gold : 'rgba(253,247,235,0.58)', marginTop: 3 }}>
                    {wallet?.eligible_for_payout ? '✓ Eligible' : `Min: ${money(wallet?.payout_threshold)}`}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                {[
                  ['Pending hold', money(wallet?.pending_balance)],
                  ['Paid out', money(wallet?.total_paid_out)],
                ].map(([label, value]) => (
                  <View key={label} style={{ flex: 1, borderRadius: 10, backgroundColor: 'rgba(253,247,235,0.08)', padding: 10 }}>
                    <Text style={{ fontSize: 10.5, color: 'rgba(253,247,235,0.58)' }}>{label}</Text>
                    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: '#fdf7eb', marginTop: 3 }}>{value}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* CTAs */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity
                onPress={() => {
                  const bal = parseFloat(String(wallet?.available_balance ?? '0'));
                  setWithdrawAmount(isFinite(bal) ? bal.toFixed(2) : '0.00');
                  setShowWithdrawModal(true);
                }}
                disabled={!wallet?.eligible_for_payout}
                style={{
                  flex: 1, height: 50, borderRadius: 14,
                  borderWidth: 1,
                  borderColor: wallet?.eligible_for_payout ? colors.gold : colors.border,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                  opacity: wallet?.eligible_for_payout ? 1 : 0.5,
                }}
              >
                <MaterialCommunityIcons
                  name="bank-transfer-out"
                  size={17}
                  color={wallet?.eligible_for_payout ? colors.gold : colors.muted}
                />
                <Text style={{
                  fontFamily: fonts.bodySemiBold, fontSize: 13,
                  color: wallet?.eligible_for_payout ? colors.gold : colors.muted,
                }}>
                  Withdraw
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => router.push('/agent/onboard')}
                style={{
                  flex: 2, height: 50, borderRadius: 14, backgroundColor: colors.ink,
                  flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <MaterialCommunityIcons name="plus" size={18} color="#fdf7eb" />
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: '#fdf7eb' }}>Onboard new trader</Text>
              </TouchableOpacity>
            </View>

            {/* Pipeline preview — G-M6: tappable rows + "See all" */}
            {pipeline.length > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
                    Active pipeline · {workspace?.active_traders ?? pipeline.length}
                  </Text>
                  <TouchableOpacity onPress={() => router.push('/agent/pipeline')}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.brand }}>See all</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' }}>
                  {pipeline.map((t, i) => {
                    const tone = kycTone(t.kyc_status ?? '');
                    const pill = pillColor(tone, colors);
                    const bizName = t.business_name ?? t.business?.name ?? 'Business';
                    const ownerName = t.name ?? t.owner_phone ?? '';
                    const businessId = String(t.business_id ?? t.id ?? '');
                    return (
                      <TouchableOpacity
                        key={String(t.id ?? i)}
                        onPress={() => router.push(`/agent/pipeline?highlight=${businessId}` as never)}
                        activeOpacity={0.7}
                        style={{
                          paddingHorizontal: 12, paddingVertical: 12,
                          borderBottomWidth: i < pipeline.length - 1 ? 1 : 0, borderBottomColor: colors.border,
                          flexDirection: 'row', gap: 10, alignItems: 'center',
                        }}
                      >
                        <View style={{
                          width: 36, height: 36, borderRadius: 18,
                          backgroundColor: `${colors.ink}08`, alignItems: 'center', justifyContent: 'center',
                        }}>
                          <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.muted }}>
                            {initials(bizName)}
                          </Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{bizName}</Text>
                          {ownerName ? <Text style={{ fontSize: 11, color: colors.muted }}>{ownerName}</Text> : null}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: pill.bg }}>
                            <Text style={{ fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: pill.text }}>
                              {kycLabel(t.kyc_status ?? '')}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="chevron-right" size={14} color={colors.border} />
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}

            {pipeline.length === 0 && !tradersLoading && (
              <View style={{ alignItems: 'center', paddingVertical: 32 }}>
                <Text style={{ fontSize: 14, color: colors.muted, textAlign: 'center' }}>
                  No traders in your pipeline yet.{'\n'}Start by onboarding a new trader.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* Withdraw modal */}
      <Modal visible={showWithdrawModal} transparent animationType="slide" onRequestClose={() => setShowWithdrawModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableOpacity style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} activeOpacity={1} onPress={() => setShowWithdrawModal(false)} />
          <View style={{ backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 34 }}>
            <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink, marginBottom: 4 }}>
              Withdraw funds
            </Text>
            <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
              Available: {money(wallet?.available_balance)} · Paid to your registered MoMo
            </Text>
            <View style={{ marginBottom: 20 }}>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, letterSpacing: 0.6, marginBottom: 4 }}>AMOUNT (GH₵)</Text>
              <TextInput
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.ink, backgroundColor: colors.bg }}
              />
            </View>
            <TouchableOpacity
              disabled={withdraw.isPending || !withdrawAmount || !isFinite(Number(withdrawAmount)) || Number(withdrawAmount) <= 0}
              onPress={() => {
                const amt = Number(withdrawAmount);
                const max = parseFloat(String(wallet?.available_balance ?? '0'));
                if (!isFinite(amt) || amt <= 0) { Alert.alert('Invalid amount', 'Enter a valid withdrawal amount.'); return; }
                if (amt > max) { Alert.alert('Exceeds balance', `Max withdrawal is ${money(max)}.`); return; }
                withdraw.mutate({ amount: amt }, {
                  onSuccess: () => { setShowWithdrawModal(false); setWithdrawAmount(''); Alert.alert('Withdrawal initiated', 'Funds will arrive in your MoMo within minutes.'); },
                  onError: (e: Error) => Alert.alert('Withdrawal failed', e.message ?? 'Please try again.'),
                });
              }}
              style={{ height: 46, borderRadius: 12, backgroundColor: colors.gold, alignItems: 'center', justifyContent: 'center', opacity: (withdraw.isPending || !withdrawAmount || !isFinite(Number(withdrawAmount)) || Number(withdrawAmount) <= 0) ? 0.6 : 1 }}
            >
              {withdraw.isPending ? <ActivityIndicator size="small" color={colors.ink} /> : <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Withdraw</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}
