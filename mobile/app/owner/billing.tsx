import { ActivityIndicator, Alert, ScrollView, TouchableOpacity, View } from 'react-native';
import { useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/api/client';
import { useBillingWorkspace, useCancelSubscription, useSelectPlan } from '@/api/hooks/featureHooks';

export default function BillingScreen() {
  const { colors, fonts } = useTheme();
  const business = useAuthStore((s) => s.business);
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch } = useBillingWorkspace();
  const selectPlan = useSelectPlan();
  const cancel = useCancelSubscription();
  const [billingInterval, setBillingInterval] = useState<'monthly' | 'annual'>('monthly');

  const plans = data?.plans ?? [];
  const subscription = data?.subscription;
  const planUsage = data?.planUsage;
  const transactions = data?.transactions ?? [];

  const currentTier = subscription?.plan?.toLowerCase() ?? '';
  const currentPlan = plans.find((p) => p.name.toLowerCase() === currentTier);
  const currentPlanPrice = currentPlan?.price ?? currentPlan?.price_ghs;
  const currentPlanAnnualPrice = currentPlan?.annual_price_ghs;

  function formatLimit(value?: number | null) {
    if (value === null || value === undefined || value < 0) return 'Unlimited';
    return value.toLocaleString('en-GH');
  }

  function formatFeature(value: unknown) {
    if (value === true) return 'Included';
    if (value === false || value === null || value === undefined) return 'Not included';
    return String(value).charAt(0).toUpperCase() + String(value).slice(1);
  }

  function usageRatio(used?: number, limit?: number | null) {
    if (limit === null || limit === undefined || limit <= 0) return 0;
    return Math.min(1, Math.max(0, Number(used ?? 0) / limit));
  }

  async function verifyAndActivate(providerRef: string): Promise<boolean> {
    try {
      const res = await apiClient.post('/api/v1/billing/subscribe/verify', {
        provider_ref: providerRef,
      });
      return res.data?.activated === true;
    } catch {
      return false;
    }
  }

  function displayPlanPrice(plan: typeof plans[number]) {
    if (plan.name.toLowerCase() === 'free') return 'Free';
    const amount = billingInterval === 'annual' ? plan.annual_price_ghs : (plan.price ?? plan.price_ghs);
    return `GH₵ ${Number(amount ?? 0).toLocaleString('en-GH')}`;
  }

  function handleSelect(tier: string) {
    selectPlan.mutate({ tier, billing_interval: billingInterval }, {
      onSuccess: async (response) => {
        if (response?.payment_url && response?.provider_ref) {
          // Open Paystack checkout — pre-filled with customer email, no form needed
          await WebBrowser.openBrowserAsync(response.payment_url, {
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.FULL_SCREEN,
          });

          // Browser closed — verify payment directly with Paystack and activate if paid
          const activated = await verifyAndActivate(response.provider_ref);
          await queryClient.invalidateQueries({ queryKey: ['billing-workspace'] });

          if (activated) {
            Alert.alert('Plan activated!', `You're now on the ${tier} plan.`);
          }
          // If not yet confirmed, the webhook will activate it — no alert needed
        } else {
          // Free plan / downgrade — activated immediately, no payment
          Alert.alert('Plan updated', 'Your plan has been changed.');
        }
      },
      onError: (e: Error) => Alert.alert('Error', e.message ?? 'Could not update plan.'),
    });
  }

  function handleCancel() {
    Alert.alert(
      'Cancel subscription?',
      'You will keep access until the end of your current billing period, then revert to the free plan.',
      [
        { text: 'Keep plan', style: 'cancel' },
        {
          text: 'Cancel subscription',
          style: 'destructive',
          onPress: () =>
            cancel.mutate(undefined, {
              onSuccess: () =>
                Alert.alert('Subscription cancelled', 'Your plan will revert to Free at the end of the billing period.'),
              onError: (e: Error) =>
                Alert.alert('Error', e.message ?? 'Could not cancel subscription.'),
            }),
        },
      ],
    );
  }

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <ActivityIndicator color={colors.brand} size="large" />
      </SafeAreaView>
    );
  }

  if (isError) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center' }} edges={['top']}>
        <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', marginBottom: 12 }}>
          Could not load billing data.
        </Text>
        <TouchableOpacity onPress={() => void refetch()} style={{ paddingVertical: 9, paddingHorizontal: 20, borderRadius: 10, backgroundColor: colors.inverse }}>
          <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#fdf7eb' }}>Retry</Text>
        </TouchableOpacity>
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
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Plan & billing</Text>
        <Text style={{ fontSize: 12, color: colors.muted }}>{business?.name ?? 'Your business'}</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {/* Current plan summary */}
        {subscription && (
          <View style={{
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11,
          }}>
            <View style={{
              width: 38, height: 38, borderRadius: 10,
              backgroundColor: `${colors.brand}15`, alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name="star-outline" size={18} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6 }}>Current plan</Text>
              <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                {subscription.plan ?? 'Free'}
                {subscription.billing_interval === 'annual' && currentPlanAnnualPrice
                  ? ` · GH₵ ${Number(currentPlanAnnualPrice).toLocaleString('en-GH')} / year`
                  : currentPlanPrice
                  ? ` · GH₵ ${Number(currentPlanPrice).toLocaleString('en-GH')} / month`
                  : ''}
              </Text>
              {subscription.current_period_end && (
                <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                  {subscription.cancel_at_period_end ? 'Expires' : 'Renews'} {new Date(subscription.current_period_end).toLocaleDateString('en-GH', { day: 'numeric', month: 'short' })}
                </Text>
              )}
              {subscription.cancel_at_period_end && (
                <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: '#fff5cc', alignSelf: 'flex-start', marginTop: 4 }}>
                  <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>Cancellation scheduled</Text>
                </View>
              )}
            </View>
            <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: subscription.status === 'active' ? `${colors.brand}15` : '#fff5cc' }}>
              <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: subscription.status === 'active' ? colors.brand : '#b6831e' }}>
                {subscription.status ?? 'active'}
              </Text>
            </View>
          </View>
        )}

        {planUsage ? (
          <View style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            padding: 13,
            gap: 12,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <MaterialCommunityIcons name="chart-timeline-variant" size={18} color={colors.brand} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Usage this month</Text>
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>
                  Limits are checked per business, not per phone number.
                </Text>
              </View>
            </View>

            {[
              ['Sales', planUsage.usage?.monthly_sales, planUsage.limits?.monthly_sales],
              ['Inventory items', planUsage.usage?.items, planUsage.limits?.items],
              ['Customers', planUsage.usage?.customers, planUsage.limits?.customers],
              ['Invoices', planUsage.usage?.monthly_invoices, planUsage.limits?.monthly_invoices],
              ['Employees', planUsage.usage?.employees, planUsage.limits?.employees],
              ['Team members', planUsage.usage?.team_members, planUsage.limits?.team_members],
              ['AI messages', planUsage.usage?.ai_messages, planUsage.limits?.ai_messages],
              ['Businesses', planUsage.usage?.businesses, planUsage.limits?.businesses],
            ].map(([label, used, limit]) => {
              const ratio = usageRatio(Number(used ?? 0), limit as number | null | undefined);
              const nearLimit = ratio >= 0.8 && (limit as number | null | undefined) !== null && (limit as number | undefined) !== undefined && Number(limit) > 0;
              return (
                <View key={label as string}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5, gap: 10 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>{label}</Text>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: nearLimit ? '#b6831e' : colors.ink }}>
                      {Number(used ?? 0).toLocaleString('en-GH')} / {formatLimit(limit as number | null | undefined)}
                    </Text>
                  </View>
                  <View style={{ height: 5, borderRadius: 999, backgroundColor: `${colors.ink}0d`, overflow: 'hidden' }}>
                    <View style={{
                      width: `${Math.max(0, Math.round(ratio * 100))}%` as never,
                      height: '100%' as never,
                      backgroundColor: nearLimit ? colors.gold : colors.brand,
                    }} />
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {planUsage?.limits ? (
          <View style={{
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 14,
            overflow: 'hidden',
          }}>
            {[
              ['Analytics', formatFeature(planUsage.limits.analytics)],
              ['Export reports', formatFeature(planUsage.limits.export)],
              ['Credit scoring', formatFeature(planUsage.limits.credit_scoring)],
              ['Invoice PDFs', formatFeature(planUsage.limits.invoice_pdf)],
              ['GRA submission', formatFeature(planUsage.limits.gra_submission)],
              ['Bulk CSV import', formatFeature(planUsage.limits.bulk_csv_import)],
            ].map(([label, value], index) => {
              const included = value !== 'Not included';
              return (
                <View key={label} style={{
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderBottomWidth: index < 5 ? 1 : 0,
                  borderBottomColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 9,
                }}>
                  <MaterialCommunityIcons
                    name={included ? 'check-circle-outline' : 'lock-outline'}
                    size={17}
                    color={included ? colors.brand : colors.muted}
                  />
                  <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{label}</Text>
                  <Text style={{ fontSize: 12, color: included ? colors.brand : colors.muted }}>{value}</Text>
                </View>
              );
            })}
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 4, gap: 4 }}>
          {(['monthly', 'annual'] as const).map((interval) => {
            const selected = billingInterval === interval;
            return (
              <TouchableOpacity
                key={interval}
                onPress={() => setBillingInterval(interval)}
                style={{
                  flex: 1,
                  height: 38,
                  borderRadius: 9,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selected ? colors.ink : 'transparent',
                }}
              >
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: selected ? '#fdf7eb' : colors.ink }}>
                  {interval === 'annual' ? 'Annual · 2 months free' : 'Monthly'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Plan cards */}
        {plans.map((p) => {
          const isSameTier = p.name.toLowerCase() === currentTier || (currentTier === '' && p.price === '0');
          const isCurrent = isSameTier && (p.name.toLowerCase() === 'free' || (subscription?.billing_interval ?? 'monthly') === billingInterval);
          const planPrice = p.price ?? p.price_ghs;
          const selectedPrice = billingInterval === 'annual' ? p.annual_price_ghs : planPrice;
          const isHigher = selectedPrice && Number(selectedPrice) > Number(currentPlanPrice ?? 0);
          return (
            <View key={p.name} style={{
              backgroundColor: isCurrent ? colors.ink : colors.surface,
              borderWidth: isCurrent ? 0 : 1, borderColor: colors.border,
              borderRadius: 16, padding: 16, overflow: 'hidden',
            }}>
              {isCurrent ? (
                <View style={{ position: 'absolute', top: -24, right: -24, width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(212,162,58,0.15)' }} />
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, letterSpacing: -0.3, color: isCurrent ? '#fdf7eb' : colors.ink }}>{p.name}</Text>
                  <Text style={{ fontSize: 11, color: isCurrent ? 'rgba(245,239,225,0.6)' : colors.muted, marginTop: 1 }}>
                    {p.name.toLowerCase() === 'free' ? 'Forever free' : billingInterval === 'annual' ? '/year' : '/month'}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 22, letterSpacing: -0.5, color: isCurrent ? '#fdf7eb' : colors.ink }}>
                    {displayPlanPrice(p)}
                  </Text>
                  {billingInterval === 'annual' && p.name.toLowerCase() !== 'free' ? (
                    <Text style={{ fontSize: 10.5, color: isCurrent ? 'rgba(245,239,225,0.6)' : colors.muted }}>
                      2 months free
                    </Text>
                  ) : null}
                  {isCurrent ? (
                    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#fff5cc', marginTop: 2 }}>
                      <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>Current</Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {p.features && p.features.length > 0 && (
                <View style={{ marginTop: 10, gap: 5 }}>
                  {p.features.map((f) => (
                    <View key={f} style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <MaterialCommunityIcons name="check" size={13} color={isCurrent ? colors.gold : colors.brand} />
                      <Text style={{ fontSize: 12, color: isCurrent ? 'rgba(245,239,225,0.85)' : colors.ink }}>{f}</Text>
                    </View>
                  ))}
                </View>
              )}

              {!isCurrent ? (
                <TouchableOpacity
                  onPress={() => handleSelect(p.name.toLowerCase())}
                  disabled={selectPlan.isPending}
                  style={{
                    marginTop: 12, height: 44, borderRadius: 12,
                    backgroundColor: isHigher ? colors.gold : colors.brand,
                    alignItems: 'center', justifyContent: 'center',
                    opacity: selectPlan.isPending ? 0.6 : 1,
                  }}
                >
                  {selectPlan.isPending
                    ? <ActivityIndicator size="small" color={isHigher ? colors.ink : '#fff'} />
                    : <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: isHigher ? colors.ink : '#fff' }}>
                        {isHigher ? 'Upgrade' : 'Downgrade'}
                      </Text>
                  }
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        {/* Recent transactions */}
        {transactions.length > 0 && (
          <>
            <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7, marginTop: 4 }}>
              Recent payments
            </Text>
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>
              {transactions.slice(0, 3).map((tx, i) => (
                <View key={tx.id} style={{
                  paddingHorizontal: 12, paddingVertical: 10,
                  borderBottomWidth: i < Math.min(transactions.length, 3) - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                  flexDirection: 'row', alignItems: 'center',
                }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{tx.provider ?? 'Payment'}</Text>
                    {tx.created_at && (
                      <Text style={{ fontSize: 11, color: colors.muted }}>
                        {new Date(tx.created_at).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontFamily: fonts.mono, fontSize: 13, color: colors.ink }}>GH₵ {Number(tx.amount ?? 0).toLocaleString()}</Text>
                    <View style={{
                      marginTop: 2, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999,
                      backgroundColor: tx.status === 'success' ? `${colors.brand}15` : '#fff5cc',
                    }}>
                      <Text style={{ fontSize: 10, fontFamily: fonts.bodySemiBold, color: tx.status === 'success' ? colors.brand : '#b6831e' }}>
                        {tx.status ?? 'pending'}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}

        {/* Cancel subscription — only shown for active paid plans */}
        {subscription?.status === 'active' && currentTier !== 'free' && !subscription.cancel_at_period_end && (
          <TouchableOpacity
            disabled={cancel.isPending}
            onPress={handleCancel}
            style={{
              marginTop: 8,
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.danger,
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: 6,
              opacity: cancel.isPending ? 0.6 : 1,
            }}
          >
            {cancel.isPending ? (
              <ActivityIndicator size="small" color={colors.danger} />
            ) : (
              <>
                <MaterialCommunityIcons name="cancel" size={16} color={colors.danger} />
                <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.danger }}>
                  Cancel subscription
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
