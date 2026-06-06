import { useState } from 'react';
import { ActivityIndicator, Alert, Share, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAgentReferralCode, useAgentWalletWorkspace, useAgentWorkspace } from '@/api/hooks/featureHooks';
import { useLogoutSession } from '@/api/hooks/sessionHooks';
import { useAuthStore } from '@/store/auth';
import { useTheme } from '@/lib/theme';

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return 'Pending';
  return new Date(value).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' });
}

function badgeVariant(status: string): 'paid' | 'pending' | 'failed' {
  if (status === 'paid' || status === 'completed' || status === 'success') return 'paid';
  if (status === 'failed' || status === 'reversed') return 'failed';
  return 'pending';
}

export default function AgentMoreScreen() {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  // G-M11: wallet data kept here for the Earnings section — not duplicating the main card
  const { data: walletWorkspace } = useAgentWalletWorkspace();
  const { data: workspace } = useAgentWorkspace();
  // G-M12: referral code
  const { data: referralCode, isLoading: referralLoading } = useAgentReferralCode();

  const logout = useLogoutSession();
  const wallet = walletWorkspace?.wallet;
  const commissions = walletWorkspace?.commissions ?? [];
  const history = walletWorkspace?.history ?? [];

  // Date filter state for commissions (current month by default)
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const filteredCommissions = commissions.filter((c) => {
    if (!c.created_at) return true;
    return c.created_at.startsWith(selectedMonth);
  });

  async function handleShareReferral() {
    if (!referralCode) return;
    try {
      await Share.share({
        message: `Join SMEflow and manage your business better! Use my referral link: ${referralCode.deep_link}`,
        url: referralCode.deep_link,
      });
    } catch {
      Alert.alert('Share failed', 'Could not open share sheet.');
    }
  }

  return (
    <Screen>
      <SectionHeader title="Earnings & Account" subtitle="Commission history, payouts, and settings" />

      {/* G-M12: Referral code card */}
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>Your referral code</Text>
          {referralLoading && <ActivityIndicator size="small" color={colors.muted} />}
        </View>
        {referralCode ? (
          <>
            <View style={{
              backgroundColor: `${colors.brand}10`,
              borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.brand, letterSpacing: 2 }}>
                {referralCode.referral_code}
              </Text>
              <TouchableOpacity onPress={handleShareReferral} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <MaterialCommunityIcons name="share-variant-outline" size={18} color={colors.brand} />
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.brand }}>Share</Text>
              </TouchableOpacity>
            </View>
            <Text style={{ fontSize: 11, color: colors.muted }}>
              Traders who sign up using your code are automatically attributed to you.
            </Text>
          </>
        ) : !referralLoading ? (
          <Text style={{ color: colors.muted }}>Referral code unavailable.</Text>
        ) : null}
      </Card>

      {/* Commission history — G-M11: now the primary content here, not duplicating dashboard wallet card */}
      <Card style={{ gap: spacing.sm }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>Commission history</Text>
          {/* Simple month selector using text chips */}
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {[-1, 0].map((offset) => {
              const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
              const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
              const label = d.toLocaleDateString('en-GH', { month: 'short' });
              return (
                <TouchableOpacity
                  key={key}
                  onPress={() => setSelectedMonth(key)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                    backgroundColor: selectedMonth === key ? `${colors.brand}15` : `${colors.ink}08`,
                  }}
                >
                  <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: selectedMonth === key ? colors.brand : colors.muted }}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
        {filteredCommissions.length === 0 ? (
          <Text style={{ color: colors.muted }}>No commissions for this period.</Text>
        ) : null}
        {filteredCommissions.map((commission, index) => {
          const status = String(commission.status ?? 'pending');
          return (
            <View key={commission.id ?? index} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: fonts.bodySemiBold }}>
                  {(commission.trigger ?? 'commission').replace(/_/g, ' ')}
                </Text>
                <Text style={{ color: colors.muted, fontSize: 11 }}>
                  {money(commission.amount_ghs ?? commission.amount)}
                  {status === 'pending' && commission.available_at
                    ? ` · Available ${shortDate(commission.available_at)}`
                    : ` · ${shortDate(commission.paid_at ?? commission.created_at)}`}
                </Text>
              </View>
              <Badge label={status} variant={badgeVariant(status)} />
            </View>
          );
        })}
      </Card>

      {/* Payout history */}
      <Card style={{ gap: spacing.sm }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>Payout history</Text>
        {history.length === 0 ? (
          <Text style={{ color: colors.muted }}>No payouts have been sent yet.</Text>
        ) : null}
        {history.map((item) => (
          <View key={item.batch_id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold }}>{money(item.amount_ghs)}</Text>
              <Text style={{ color: colors.muted, fontSize: 11 }}>
                {shortDate(item.completed_at ?? item.payout_date)}
                {item.transfer_code ? ` · ${item.transfer_code}` : ''}
              </Text>
            </View>
            <Badge label={item.status} variant={badgeVariant(item.status)} />
          </View>
        ))}
      </Card>

      {/* G-M11: Profile / settings — no duplicate wallet balances */}
      <Card style={{ gap: spacing.sm }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>Profile</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View>
            <Text style={{ color: colors.ink }}>{workspace?.name ?? user?.name ?? 'Field agent'}</Text>
            <Text style={{ color: colors.muted, fontSize: 12 }}>{user?.phone ?? 'No phone on file'}</Text>
            {workspace?.region && (
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {workspace.district ? `${workspace.district}, ` : ''}{workspace.region}
              </Text>
            )}
          </View>
        </View>
        <Button
          label="Log out"
          loading={logout.isPending}
          onPress={() => logout.mutate(undefined, { onSettled: () => router.replace('/') })}
          variant="ghost"
        />
      </Card>
    </Screen>
  );
}
