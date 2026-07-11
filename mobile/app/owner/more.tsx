import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, Switch, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { useUIStore } from '@/store/ui';
import { useSwitchBusiness } from '@/api/hooks/sessionHooks';
import { useState } from 'react';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

interface MenuItem {
  icon: IconName;
  label: string;
  sub: string;
  route: string;
  accent?: string;
}

const SECTIONS: Array<{ title: string; items: MenuItem[] }> = [
  {
    title: 'Finance',
    items: [
      { icon: 'trending-up',          label: 'Analytics',         sub: 'Revenue, P&L, cash flow, customers',  route: '/owner/analytics' },
      { icon: 'credit-card-outline',  label: 'Credit & Loans',    sub: 'Credit score and loan requests',       route: '/owner/credit' },
      { icon: 'account-cash-outline', label: 'Payroll',           sub: 'Employees and salary runs',            route: '/owner/payroll' },
      { icon: 'file-chart-outline',   label: 'Tax & Compliance',  sub: 'VAT, GRA filings, deadlines',          route: '/owner/tax' },
    ],
  },
  {
    title: 'Records',
    items: [
      { icon: 'receipt',              label: 'Sales history',     sub: 'All transactions and receipts',        route: '/owner/sales' },
      { icon: 'file-document-outline',label: 'Invoices',          sub: 'B2B invoices with VAT',                route: '/owner/invoices' },
      { icon: 'account-group-outline',label: 'Customers',         sub: 'Customer profiles and credit owed',    route: '/owner/customers' },
      { icon: 'package-variant',      label: 'Inventory',         sub: 'Stock levels and low-stock alerts',    route: '/owner/inventory' },
      { icon: 'wallet-outline',       label: 'Payments',          sub: 'Wallets, payouts & GhQR',              route: '/owner/payments-history' },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'cash-register',        label: 'Cashier mode',      sub: 'Open shift · locked-down POS',         route: '/owner/cashier',       accent: '#b6831e' },
      { icon: 'bell-outline',         label: 'Notifications',     sub: 'Alerts and delivery settings',        route: '/owner/notifications', accent: '#1f6a4f' },
      { icon: 'account-heart-outline',label: 'Refer a trader',    sub: 'Invite traders and track rewards',    route: '/owner/referrals',     accent: '#b6831e' },
      { icon: 'star-circle-outline',  label: 'Billing & Plan',    sub: 'Subscription and upgrade options',     route: '/owner/billing' },
      { icon: 'shield-check-outline', label: 'KYC Status',        sub: 'Identity verification status',         route: '/owner/kyc-status' },
      { icon: 'cog-outline',          label: 'Settings',          sub: 'Profile, team, wallets, preferences',  route: '/owner/settings' },
    ],
  },
];

const SUBSCRIPTION_LABELS: Record<string, string> = {
  free: 'Free',
  paid: 'Pro',
  premium: 'Premium',
};

function subscriptionColor(sub: string) {
  if (sub === 'premium') return '#b6831e';
  if (sub === 'paid') return '#1f6a4f';
  return undefined;
}

export default function MoreScreen() {
  const { colors, fonts, isDark } = useTheme();
  const setTheme = useUIStore((s) => s.setTheme);
  const router = useRouter();
  const business = useAuthStore((s) => s.business);
  const businesses = useAuthStore((s) => s.businesses);
  const switchBusiness = useSwitchBusiness();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  function handleSwitch(businessId: string, isCurrent: boolean) {
    if (isCurrent || switchBusiness.isPending) return;
    setSwitchingId(businessId);
    switchBusiness.mutate(businessId, {
      onSettled: () => {
        setSwitchingId(null);
      },
      onSuccess: () => {
        setSwitcherOpen(false);
      },
      onError: (e: Error) => {
        Alert.alert('Could not switch business', e.message ?? 'Please try again.');
      },
    });
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16, paddingVertical: 12,
        borderBottomWidth: 1, borderBottomColor: colors.border,
        backgroundColor: colors.surface,
      }}>
        <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>More</Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>

        {/* Business context card */}
        {business && (
          <View style={{ marginBottom: 16 }}>
            <Text style={{
              fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold,
              textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
            }}>
              Active business
            </Text>
            <TouchableOpacity
              onPress={() => setSwitcherOpen(true)}
              style={{
                backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
                borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
                flexDirection: 'row', alignItems: 'center', gap: 10,
              }}
            >
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: `${colors.brand}15`,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name="store-outline" size={18} color={colors.brand} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                  {business.name}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
                  <Text style={{ fontSize: 11, color: colors.muted, textTransform: 'capitalize' }}>
                    {business.type?.replace('_', ' ')}
                  </Text>
                  {business.subscription ? (
                    <>
                      <Text style={{ fontSize: 11, color: colors.muted }}>·</Text>
                      <Text style={{
                        fontSize: 10, fontFamily: fonts.bodySemiBold,
                        color: subscriptionColor(business.subscription) ?? colors.muted,
                        textTransform: 'uppercase', letterSpacing: 0.4,
                      }}>
                        {SUBSCRIPTION_LABELS[business.subscription] ?? business.subscription}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ fontSize: 11.5, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                  Switch
                </Text>
                <MaterialCommunityIcons name="chevron-down" size={14} color={colors.brand} />
              </View>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Appearance ── */}
        <View style={{ marginBottom: 16 }}>
          <Text style={{
            fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold,
            textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
          }}>
            Appearance
          </Text>
          <View style={{
            backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
            borderRadius: 14, paddingHorizontal: 12, paddingVertical: 12,
            flexDirection: 'row', alignItems: 'center', gap: 11,
          }}>
            <View style={{
              width: 30, height: 30, borderRadius: 8,
              backgroundColor: isDark ? `${colors.ink}20` : `${colors.ink}08`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons
                name={isDark ? 'weather-night' : 'white-balance-sunny'}
                size={15}
                color={colors.muted}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                {isDark ? 'Dark mode' : 'Light mode'}
              </Text>
              <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>
                {isDark ? 'Tap to switch to light mode' : 'Tap to switch to dark mode'}
              </Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={(v) => setTheme(v ? 'dark' : 'warm')}
              trackColor={{ false: colors.border, true: colors.brand }}
              thumbColor={isDark ? '#fff' : '#fff'}
            />
          </View>
        </View>

        {/* Nav sections */}
        {SECTIONS.map((sec) => (
          <View key={sec.title} style={{ marginBottom: 16 }}>
            <Text style={{
              fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold,
              textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6,
            }}>
              {sec.title}
            </Text>
            <View style={{
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              borderRadius: 14, overflow: 'hidden',
            }}>
              {sec.items.map((item, i) => (
                <TouchableOpacity
                  key={item.route}
                  onPress={() => router.push(item.route as Href)}
                  style={{
                    flexDirection: 'row', gap: 11, paddingHorizontal: 12, paddingVertical: 11,
                    alignItems: 'center',
                    borderBottomWidth: i < sec.items.length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{
                    width: 30, height: 30, borderRadius: 8,
                    backgroundColor: item.accent ? `${item.accent}12` : `${colors.ink}08`,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons
                      name={item.icon}
                      size={15}
                      color={item.accent ?? colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{item.label}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted, marginTop: 1 }}>{item.sub}</Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={16} color={colors.muted} />
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Business switcher bottom sheet */}
      <Modal
        visible={switcherOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSwitcherOpen(false)}
      >
        <Pressable
          style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}
          onPress={() => { if (!switchBusiness.isPending) setSwitcherOpen(false); }}
        >
          <Pressable onPress={() => {/* stop propagation */}}>
            <View style={{
              backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20,
              paddingBottom: 32,
            }}>
              {/* Sheet handle */}
              <View style={{ alignItems: 'center', paddingTop: 10, paddingBottom: 4 }}>
                <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: `${colors.ink}20` }} />
              </View>

              {/* Header */}
              <View style={{
                flexDirection: 'row', alignItems: 'center',
                paddingHorizontal: 16, paddingVertical: 10,
                borderBottomWidth: 1, borderBottomColor: colors.border,
              }}>
                <Text style={{ flex: 1, fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>
                  Your businesses
                </Text>
                <TouchableOpacity
                  onPress={() => setSwitcherOpen(false)}
                  disabled={switchBusiness.isPending}
                  style={{ padding: 4 }}
                >
                  <MaterialCommunityIcons name="close" size={18} color={colors.muted} />
                </TouchableOpacity>
              </View>

              {/* Business list */}
              {businesses.map((b, i) => {
                const isCurrent = b.is_current;
                const isSwitching = switchingId === b.business_id;
                const isDisabled = switchBusiness.isPending && !isSwitching;
                return (
                  <TouchableOpacity
                    key={b.business_id}
                    onPress={() => handleSwitch(b.business_id, isCurrent)}
                    disabled={isDisabled || isCurrent}
                    style={{
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      paddingHorizontal: 16, paddingVertical: 13,
                      borderBottomWidth: i < businesses.length - 1 ? 1 : 0,
                      borderBottomColor: colors.border,
                      opacity: isDisabled ? 0.4 : 1,
                    }}
                  >
                    <View style={{
                      width: 36, height: 36, borderRadius: 10,
                      backgroundColor: isCurrent ? `${colors.brand}15` : `${colors.ink}08`,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {isSwitching ? (
                        <ActivityIndicator size="small" color={colors.brand} />
                      ) : (
                        <MaterialCommunityIcons
                          name="store-outline"
                          size={17}
                          color={isCurrent ? colors.brand : colors.muted}
                        />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>
                        {b.business_name}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 4, marginTop: 2, alignItems: 'center' }}>
                        <Text style={{ fontSize: 11, color: colors.muted, textTransform: 'capitalize' }}>
                          {b.role}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.muted }}>·</Text>
                        <Text style={{
                          fontSize: 10, fontFamily: fonts.bodySemiBold,
                          color: subscriptionColor(b.subscription) ?? colors.muted,
                          textTransform: 'uppercase', letterSpacing: 0.4,
                        }}>
                          {SUBSCRIPTION_LABELS[b.subscription] ?? b.subscription}
                        </Text>
                      </View>
                    </View>
                    {isCurrent && (
                      <MaterialCommunityIcons name="check-circle" size={18} color={colors.brand} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {/* Add new business */}
              <TouchableOpacity
                onPress={() => { setSwitcherOpen(false); router.push('/owner/add-business'); }}
                disabled={switchBusiness.isPending}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingHorizontal: 16, paddingVertical: 13,
                  marginTop: 4,
                  borderTopWidth: 1, borderTopColor: colors.border,
                }}
              >
                <View style={{
                  width: 36, height: 36, borderRadius: 10,
                  backgroundColor: `${colors.brand}12`,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="plus" size={18} color={colors.brand} />
                </View>
                <Text style={{ flex: 1, fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
                  Add a new business
                </Text>
                <MaterialCommunityIcons name="chevron-right" size={16} color={colors.brand} />
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
