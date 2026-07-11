import { useMemo, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StyledTextInput } from '@/components/ui/Inputs';
import { Screen, SectionHeader } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useAgentTraders } from '@/api/hooks/featureHooks';
import { useTheme } from '@/lib/theme';

const KYC_LABEL: Record<string, string> = {
  not_submitted: 'No KYC',
  pending:       'KYC pending',
  submitted:     'Under review',
  verified:      'KYC verified',
  approved:      'KYC verified',
  failed:        'Needs resubmission',
  rejected:      'Needs resubmission',
};

// G-M10: referral lifecycle labels
const REFERRAL_LABEL: Record<string, string> = {
  registered:  'Registered',
  first_sale:  'First sale ✓',
  active:      'Active',
  churned:     'Churned',
};

const REFERRAL_VARIANT: Record<string, 'verified' | 'pending' | 'failed'> = {
  registered: 'pending',
  first_sale: 'verified',
  active:     'verified',
  churned:    'failed',
};

function kycBadgeVariant(status: string): 'verified' | 'pending' | 'failed' {
  if (status === 'verified' || status === 'approved') return 'verified';
  if (status === 'failed' || status === 'rejected') return 'failed';
  return 'pending';
}

export default function PipelineScreen() {
  const { colors, fonts, spacing } = useTheme();
  const router = useRouter();
  // G-M6: support highlight param from dashboard navigation
  const { highlight } = useLocalSearchParams<{ highlight?: string }>();

  const [query, setQuery] = useState('');
  const tradersQuery = useAgentTraders();

  const traders = (tradersQuery.data ?? []).map((trader, index) => ({
    id: String(trader.id ?? trader.business_id ?? index),
    businessId: String(trader.business_id ?? trader.id ?? index),
    name: String(trader.business_name ?? trader.name ?? trader.business?.name ?? 'Trader'),
    phone: String(trader.phone ?? trader.owner_phone ?? ''),
    kycStage: String(trader.kyc_status ?? 'not_submitted'),
    // G-M10: referral lifecycle status
    referralStatus: String(trader.status ?? 'registered'),
  }));

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return traders.filter(
      (t) => t.name.toLowerCase().includes(q) || t.phone.includes(q)
    );
  }, [query, traders]);

  if (tradersQuery.isError) {
    return (
      <Screen>
        <SectionHeader title="Pipeline" subtitle="Could not load traders" />
        <Card style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.danger, fontFamily: fonts.bodySemiBold }}>Could not load pipeline</Text>
          <Text style={{ color: colors.muted, fontSize: 13 }}>Check your connection and pull down to retry.</Text>
        </Card>
      </Screen>
    );
  }

  return (
    <Screen>
      <SectionHeader title="Pipeline" subtitle={`${traders.length} trader${traders.length !== 1 ? 's' : ''} · KYC and activation status`} />
      <StyledTextInput onChangeText={setQuery} placeholder="Search trader or phone" value={query} />
      <Card style={{ gap: 0, padding: 0 }}>
        {tradersQuery.isLoading ? (
          <Text style={{ color: colors.muted, padding: spacing.md }}>Loading traders…</Text>
        ) : filtered.length === 0 ? (
          <Text style={{ color: colors.muted, padding: spacing.md }}>{query ? 'No traders match your search.' : 'No traders yet.'}</Text>
        ) : null}
        {filtered.map((trader, i) => {
          const isHighlighted = trader.businessId === highlight;
          return (
            <TouchableOpacity
              key={trader.id}
              // Navigate to trader detail when tapped
              onPress={() => trader.businessId ? router.push(`/agent/trader/${trader.businessId}` as never) : undefined}
              activeOpacity={0.7}
              style={{
                paddingHorizontal: spacing.md,
                paddingVertical: 12,
                borderBottomWidth: i < filtered.length - 1 ? 1 : 0,
                borderBottomColor: colors.border,
                backgroundColor: isHighlighted ? `${colors.brand}08` : 'transparent',
                gap: 6,
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink }}>{trader.name}</Text>
                  {trader.phone ? <Text style={{ color: colors.muted, fontSize: 12 }}>{trader.phone}</Text> : null}
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {/* KYC badge */}
                  <Badge
                    label={KYC_LABEL[trader.kycStage] ?? trader.kycStage}
                    variant={kycBadgeVariant(trader.kycStage)}
                  />
                  {/* G-M10: referral lifecycle badge */}
                  <Badge
                    label={REFERRAL_LABEL[trader.referralStatus] ?? trader.referralStatus}
                    variant={REFERRAL_VARIANT[trader.referralStatus] ?? 'pending'}
                  />
                </View>
              </View>
            </TouchableOpacity>
          );
        })}
      </Card>
    </Screen>
  );
}
