import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, TouchableOpacity, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { Text } from '@/components/ui/Text';
import {
  useAnalyticsSummary,
  useDashboardSummary,
  usePredictiveRestock,
  useSalesHistory,
} from '@/api/hooks/featureHooks';
import { syncNow } from '@/db/sync/service';
import { useLocalItems } from '@/features/localData';
import {
  buildAttentionItems,
  buildHomeMetrics,
  buildHourlySalesBars,
  countUnreadMerchantAlerts,
  getTodayRange,
} from '@/features/homeDashboard';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import { ALL_QUICK_ACTIONS, useQuickActionsStore, type QuickAction } from '@/store/quickActions';
import type { DailySummaryDto } from '@/types/sales';
import { SaleDetailSheet } from '@/components/sales/SaleDetailSheet';

// ─── helpers ───────────────────────────────────────────────────────────────

function ghc(value: number) {
  return `GH₵ ${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function getTwi(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Maakye';
  if (h < 17) return 'Maa ha';
  return 'Maadwo';
}

function todayLabel(): string {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

// ─── Hero sparkline (View-based bars, derived from today's sales) ──────────
function HeroSparkline({ data }: { data: Array<{ label: string; value: number }> }) {
  const bars = data.length > 0 ? data : [
    { label: '6am', value: 0 },
    { label: '10am', value: 0 },
    { label: '2pm', value: 0 },
    { label: '6pm', value: 0 },
  ];
  const maxV = Math.max(...bars.map((bar) => bar.value), 1);
  const normalized = bars.map((bar) => bar.value / maxV);
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 36, gap: 2, marginTop: 10 }}>
        {normalized.map((h, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: Math.max(2, h * 36),
              backgroundColor: '#7adcb0',
              borderRadius: 2,
              opacity: 0.35 + h * 0.65,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 5 }}>
        {bars.map((bar) => (
          <Text key={bar.label} style={{ fontSize: 10, color: 'rgba(245,239,225,0.4)' }}>{bar.label}</Text>
        ))}
      </View>
    </>
  );
}

// ─── Payment method badge ───────────────────────────────────────────────────
const METHOD_CFG: Record<string, { bg: string; label: string; fg: string }> = {
  cash:       { bg: '#eceae4', label: '₵',    fg: '#6b6860' },
  momo:       { bg: '#fff5cc', label: 'MoMo', fg: '#b6831e' },
  mtn:        { bg: '#fff5cc', label: 'MTN',  fg: '#b6831e' },
  vodafone:   { bg: '#fde0e0', label: 'TC',   fg: '#c0392b' },
  airteltigo: { bg: '#e0e8ff', label: 'AT',   fg: '#4455cc' },
  credit:     { bg: '#fef3c7', label: 'CR',   fg: '#b6831e' },
  mixed:      { bg: '#eceae4', label: 'Mix',  fg: '#6b6860' },
};

function MethodBadge({ method }: { method: string }) {
  const cfg = METHOD_CFG[method?.toLowerCase() ?? 'cash'] ?? METHOD_CFG.cash;
  return (
    <View style={{
      width: 34, height: 34, borderRadius: 10,
      backgroundColor: cfg.bg,
      alignItems: 'center', justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Text style={{ fontSize: cfg.label === '₵' ? 15 : 9, fontWeight: '700', color: cfg.fg }}>
        {cfg.label}
      </Text>
    </View>
  );
}

// ─── Alert row ─────────────────────────────────────────────────────────────
type AlertTone = 'warn' | 'info' | 'success' | 'danger';

interface AlertRowProps {
  tone: AlertTone;
  icon: string;
  title: string;
  sub: string;
  cta: string;
  onPress?: () => void;
}

function AlertRow({ tone, icon, title, sub, cta, onPress }: AlertRowProps) {
  const { colors, fonts } = useTheme();
  const TONES = {
    warn:    { fg: colors.gold,   bg: `${colors.gold}18` },
    info:    { fg: colors.info,   bg: `${colors.info}15` },
    success: { fg: colors.brand,  bg: `${colors.brand}15` },
    danger:  { fg: colors.danger, bg: `${colors.danger}15` },
  };
  const t = TONES[tone];

  return (
    <View style={{
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderLeftWidth: 3,
      borderColor: colors.border,
      borderLeftColor: t.fg,
      borderRadius: 12,
      padding: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    }}>
      <View style={{
        width: 32, height: 32, borderRadius: 9,
        backgroundColor: t.bg,
        alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
      }}>
        <MaterialCommunityIcons name={icon as never} size={16} color={t.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
          {title}
        </Text>
        <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }} numberOfLines={1}>
          {sub}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onPress}
        style={{
          paddingHorizontal: 10, paddingVertical: 6,
          borderRadius: 999,
          backgroundColor: t.bg,
        }}
      >
        <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: t.fg }}>{cta}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Main screen ───────────────────────────────────────────────────────────
// ─── Quick actions strip ────────────────────────────────────────────────────
function QuickActionsStrip() {
  const { colors, fonts, radii } = useTheme();
  const router = useRouter();
  const { isEditing, setEditing, togglePin, pinnedIds } = useQuickActionsStore();
  const pinnedActions = useMemo(
    () => pinnedIds.map((id) => ALL_QUICK_ACTIONS.find((a) => a.id === id)).filter(Boolean) as QuickAction[],
    [pinnedIds]
  );
  const [showPicker, setShowPicker] = useState(false);

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {pinnedActions.map((a) => (
          <TouchableOpacity
            key={a.id}
            onPress={() => isEditing ? undefined : router.push(a.route as never)}
            onLongPress={() => { setEditing(true); setShowPicker(true); }}
            delayLongPress={500}
            style={{
              flex: 1, alignItems: 'center', gap: 6,
              paddingVertical: 12, paddingHorizontal: 6,
              backgroundColor: a.accent ? colors.ink : colors.surface,
              borderWidth: 1, borderColor: a.accent ? colors.ink : colors.border,
              borderRadius: 14,
            }}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: a.accent ? 'rgba(245,239,225,0.12)' : `${colors.ink}08`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons name={a.icon as never} size={18} color={a.accent ? '#fdf7eb' : colors.ink} />
            </View>
            <Text style={{ fontSize: 11.5, fontFamily: fonts.bodySemiBold, color: a.accent ? '#fdf7eb' : colors.muted }}>
              {a.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={{ fontSize: 10, color: colors.muted, textAlign: 'center', marginTop: 5 }} onPress={() => setShowPicker(true)}>
        Hold to customise
      </Text>

      {/* Picker modal */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => { setShowPicker(false); setEditing(false); }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => { setShowPicker(false); setEditing(false); }} />
        <View style={{
          backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: 20, paddingBottom: 36, maxHeight: '70%',
        }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink, marginBottom: 4 }}>
            Customise shortcuts
          </Text>
          <Text style={{ fontSize: 12, color: colors.muted, marginBottom: 16 }}>
            Tap to pin or unpin (max 4). Changes are saved automatically.
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {ALL_QUICK_ACTIONS.map((a) => {
              const pinned = pinnedIds.includes(a.id);
              return (
                <TouchableOpacity
                  key={a.id}
                  onPress={() => togglePin(a.id)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                    paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: pinned ? colors.brand : colors.border,
                    backgroundColor: pinned ? `${colors.brand}12` : colors.bg,
                  }}
                >
                  <MaterialCommunityIcons name={a.icon as never} size={16} color={pinned ? colors.brand : colors.muted} />
                  <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: pinned ? colors.brand : colors.ink }}>{a.label}</Text>
                  {pinned && <MaterialCommunityIcons name="check" size={14} color={colors.brand} />}
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            onPress={() => { setShowPicker(false); setEditing(false); }}
            style={{ marginTop: 20, height: 46, borderRadius: 12, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: '#fdf7eb' }}>Done</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

export default function HomeScreen() {
  const { colors, fonts, spacing, radii } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const todayRange = useMemo(() => getTodayRange(), []);
  // Single combined query replaces 7 parallel calls — ~60% faster on mobile networks
  const dashSummary = useDashboardSummary();
  const analytics = useAnalyticsSummary();
  const sales = useSalesHistory(todayRange);
  const predictiveRestock = usePredictiveRestock();
  const { items, reload } = useLocalItems();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [heroView, setHeroView] = useState<'today' | 'week'>('today');

  async function handleRefresh() {
    setRefreshing(true);
    await syncNow();
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['sales-history'] }),
    ]);
    await reload();
    setRefreshing(false);
  }
  const business = useAuthStore((state) => state.business);
  const momoAccounts = useAuthStore((state) => state.momoAccounts);

  const dashData = dashSummary.data;
  const daily: DailySummaryDto = (dashData?.daily_summary as DailySummaryDto | undefined) ?? {
    date: '', total_sales: 0, total_revenue: 0,
    cash_revenue: 0, momo_revenue: 0, credit_revenue: 0, top_items: [],
  };

  const todaySales = Array.isArray(sales.data) ? sales.data : [];
  const metrics = buildHomeMetrics({ daily, todaySales });
  const { revenue, salesCount, recentSales } = metrics;

  const lowStockItems = items
    .filter((item) => item.stockQty <= item.lowStockThreshold)
    .sort((a, b) => a.stockQty - b.stockQty)
    .slice(0, 3);

  const revInt = Math.floor(revenue).toLocaleString();
  const revDec = `.${Math.round((revenue % 1) * 100).toString().padStart(2, '0')}`;
  const avgSale = salesCount > 0 ? revenue / salesCount : 0;

  // G-O3: robust date comparison — parse to Date before comparing (was fragile string sort)
  const pctChange = useMemo(() => {
    const rows = Array.isArray(analytics.data) ? analytics.data : [];
    if (rows.length < 2) return null;
    const todayMs = new Date(todayRange.to_date).getTime();
    const previousRows = rows.filter((row) => {
      const d = String(row.day ?? row.period ?? '');
      if (!d) return false;
      return new Date(d).getTime() < todayMs;
    });
    const previous = previousRows[previousRows.length - 1] ?? rows[rows.length - 2];
    const yest = Number(previous?.revenue ?? previous?.total_revenue ?? 0);
    if (!yest) return null;
    return Math.round(((revenue - yest) / yest) * 100);
  }, [analytics.data, revenue, todayRange.to_date]);

  const user = useAuthStore((s) => s.user);
  const bizName = business?.name ?? 'My Business';
  const ownerFirst = (user?.name ?? bizName).split(' ')[0];

  const initials = useMemo(() => {
    return bizName.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
  }, [bizName]);

  const sparkData = useMemo(() => buildHourlySalesBars(todaySales), [todaySales]);

  // G-O6: 7-day sparkline from analytics data for "week" view
  const weekSparkData = useMemo(() => {
    const rows = Array.isArray(analytics.data) ? analytics.data : [];
    const last7 = rows.slice(-7);
    if (last7.length === 0) return sparkData; // fall back to today's data
    return last7.map((row) => ({
      label: new Date(String(row.day ?? row.period ?? '')).toLocaleDateString('en-GH', { weekday: 'narrow' }),
      value: Number(row.revenue ?? row.total_revenue ?? 0),
    }));
  }, [analytics.data, sparkData]);

  const alertRows = (dashData?.alerts?.items ?? []) as Array<{
    id: string;
    title: string;
    message: string;
    severity: string;
    action_label?: string;
    action_path?: string;
    read_at?: string | null;
  }>;
  const unreadNotifications = dashData?.alerts?.unread_count ?? countUnreadMerchantAlerts(alertRows);
  const attentionItems = buildAttentionItems({
    creditScore: dashData?.credit_score as Parameters<typeof buildAttentionItems>[0]['creditScore'],
    loanRequests: [],
    lowStockItems,
    predictiveRestockItems: (predictiveRestock.data ?? []) as Array<{ name: string; days_until_stockout: number }>,
    taxSummary: (dashData?.tax_summary as { summary?: unknown } | undefined)?.summary as Parameters<typeof buildAttentionItems>[0]['taxSummary'],
  });

  const isLoading = dashSummary.isLoading || sales.isLoading;
  const hasDashboardError = dashSummary.isError || sales.isError;
  const isAttentionLoading = dashSummary.isLoading;

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['analytics-summary'] });
      queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      let active = true;
      async function refresh() {
        await syncNow();
        if (active) await reload();
      }
      void refresh();
      return () => { active = false; };
    }, [reload, queryClient])
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ paddingBottom: 112 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.brand} />
      }
    >
      {/* ── Greeting header ── */}
      <View style={{
        paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <TouchableOpacity onPress={() => router.push('/owner/more')} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <View style={{
            width: 38, height: 38, borderRadius: 12, flexShrink: 0,
            backgroundColor: colors.brand,
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 13, color: '#fff', letterSpacing: -0.3 }}>
              {initials}
            </Text>
          </View>
          <View style={{ minWidth: 0, flex: 1 }}>
            <Text style={{
              fontSize: 10.5, color: colors.muted,
              textTransform: 'uppercase', letterSpacing: 0.8, fontFamily: fonts.bodySemiBold,
            }} numberOfLines={1}>
              {getTwi()}, {ownerFirst} ☀
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 }}>
              <Text style={{
                fontSize: 17, fontFamily: fonts.displaySemiBold, color: colors.ink,
                letterSpacing: -0.4,
              }} numberOfLines={1}>
                {bizName}
              </Text>
              <MaterialCommunityIcons name="chevron-down" size={15} color={colors.muted} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push('/owner/notifications')} style={{
          width: 38, height: 38, borderRadius: 12,
          backgroundColor: colors.surface,
          borderWidth: 1, borderColor: colors.border,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <MaterialCommunityIcons name="bell-outline" size={18} color={colors.ink} />
          {unreadNotifications > 0 && (
            <View style={{
              position: 'absolute', top: 5, right: 5,
              minWidth: 14, height: 14, borderRadius: 7,
              backgroundColor: colors.gold,
              borderWidth: 2, borderColor: colors.surface,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ fontSize: 8, color: colors.ink, fontFamily: fonts.bodySemiBold }}>
                {unreadNotifications > 9 ? '9+' : unreadNotifications}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Hero revenue card ── */}
      {hasDashboardError && (
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          <TouchableOpacity
            onPress={() => void handleRefresh()}
            style={{
              backgroundColor: `${colors.danger}10`,
              borderWidth: 1,
              borderColor: `${colors.danger}30`,
              borderRadius: 12,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <MaterialCommunityIcons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={{ flex: 1, fontSize: 12, color: colors.danger, fontFamily: fonts.bodySemiBold }}>
              Could not refresh today's dashboard. Tap to retry.
            </Text>
          </TouchableOpacity>
        </View>
      )}
      {isLoading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <CardSkeleton />
        </View>
      ) : (
        <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
          <View style={{
            backgroundColor: '#1e1b14',
            borderRadius: 18,
            padding: 16,
            paddingBottom: 14,
            overflow: 'hidden',
          }}>
            {/* Gold radial accent */}
            <View style={{
              position: 'absolute', top: 0, right: 0,
              width: 100, height: 100, borderRadius: 18,
              backgroundColor: 'rgba(212,162,58,0.22)',
            }} />

            {/* Header row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Text style={{ fontSize: 11, color: 'rgba(245,239,225,0.6)', textTransform: 'uppercase', letterSpacing: 0.9, fontFamily: fonts.bodySemiBold }}>
                Today · {todayLabel()}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: `${colors.brand}22`, borderRadius: 999 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.brand }} />
                <Text style={{ fontSize: 10.5, color: colors.brand, fontFamily: fonts.bodySemiBold }}>Live</Text>
              </View>
            </View>

            {/* Large amount */}
            <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
              <Text style={{ fontSize: 14, color: 'rgba(245,239,225,0.55)', fontFamily: fonts.bodySemiBold }}>
                GH₵
              </Text>
              <Text style={{ fontSize: 36, fontFamily: fonts.displaySemiBold, color: '#f5efe1', letterSpacing: -1, lineHeight: 40 }}>
                {revInt}
              </Text>
              <Text style={{ fontSize: 16, color: 'rgba(245,239,225,0.55)', fontFamily: fonts.body }}>
                {revDec}
              </Text>
            </View>

            {/* Change stat */}
            <View style={{ marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              {pctChange !== null ? (
                <Text style={{ color: pctChange >= 0 ? '#7adcb0' : '#f08070', fontFamily: fonts.bodySemiBold, fontSize: 12.5 }}>
                  {pctChange >= 0 ? '↑' : '↓'} {Math.abs(pctChange)}%
                </Text>
              ) : null}
              <Text style={{ fontSize: 12.5, color: 'rgba(245,239,225,0.7)' }}>
                {pctChange !== null ? 'vs. yesterday · ' : ''}{salesCount} sale{salesCount !== 1 ? 's' : ''}
              </Text>
            </View>
            {/* G-O6: today/week toggle */}
            <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, alignSelf: 'flex-start' }}>
              {(['today', 'week'] as const).map((v) => (
                <TouchableOpacity
                  key={v}
                  onPress={() => setHeroView(v)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
                    backgroundColor: heroView === v ? 'rgba(245,239,225,0.18)' : 'transparent',
                    borderWidth: 1,
                    borderColor: heroView === v ? 'rgba(245,239,225,0.35)' : 'transparent',
                  }}
                >
                  <Text style={{ fontSize: 11, color: heroView === v ? '#f5efe1' : 'rgba(245,239,225,0.45)', fontWeight: '600' }}>
                    {v === 'today' ? 'Today' : '7 days'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={{ fontSize: 11, color: 'rgba(245,239,225,0.55)', marginTop: 4 }}>
              Avg sale {ghc(avgSale)} · {heroView === 'today' ? 'hourly' : 'daily'} sales
            </Text>

            <HeroSparkline data={heroView === 'today' ? sparkData : weekSparkData} />
          </View>
        </View>
      )}

      {/* ── Split stats: Cash | MoMo sales ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 10, flexDirection: 'row', gap: 8 }}>
        {/* Cash */}
        <View style={{
          flex: 1, backgroundColor: colors.surface,
          borderWidth: 1, borderColor: colors.border,
          borderRadius: radii.md, padding: 12,
        }}>
          <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
            Cash
          </Text>
          <Text style={{ fontSize: 20, fontFamily: fonts.displaySemiBold, color: colors.ink, marginTop: 4 }}>
            {ghc(metrics.cash.revenue)}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
            {metrics.cash.count} sale{metrics.cash.count !== 1 ? 's' : ''}
          </Text>
        </View>

        {/* Online/MoMo sales */}
        <View style={{
          flex: 1, backgroundColor: colors.surface,
          borderWidth: 1, borderColor: colors.border,
          borderRadius: radii.md, padding: 12,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={{ fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
              Online/MoMo
            </Text>
            {momoAccounts.length > 0 ? (
              <View style={{ flexDirection: 'row', gap: 3 }}>
                {momoAccounts.slice(0, 3).map((wallet) => {
                  const dot = wallet.is_verified || wallet.status === 'verified'
                    ? colors.brand
                    : wallet.status === 'failed'
                      ? colors.danger
                      : colors.gold;
                  return <View key={wallet.id} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />;
                })}
              </View>
            ) : null}
          </View>
          <Text style={{ fontSize: 20, fontFamily: fonts.displaySemiBold, color: colors.ink, marginTop: 4 }}>
            {ghc(metrics.momo.revenue)}
          </Text>
          <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
            {metrics.momo.count} online sale{metrics.momo.count !== 1 ? 's' : ''}{momoAccounts.length > 0 ? ` · ${momoAccounts.length} wallet${momoAccounts.length !== 1 ? 's' : ''}` : ''}
          </Text>
        </View>
      </View>

      {/* ── Quick actions (long-press to customise) ── */}
      <QuickActionsStrip />

      {/* ── Needs attention ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 18 }}>
        <Text style={{
          fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: colors.muted,
          textTransform: 'uppercase', letterSpacing: 0.9, marginBottom: 8,
        }}>
          Needs attention
        </Text>
        <View style={{ gap: 8 }}>
          {/* G-O4: MoMo wallet nudge if no wallets configured */}
          {momoAccounts.length === 0 && !isAttentionLoading && (
            <AlertRow
              tone="warn"
              icon="wallet-plus-outline"
              title="Add a MoMo wallet"
              sub="Accept online payments and receive payouts"
              cta="Add wallet"
              onPress={() => router.push('/owner/payments-history')}
            />
          )}
          {isAttentionLoading && alertRows.length === 0 && attentionItems.length === 0 ? (
            <View style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}>
              <MaterialCommunityIcons name="sync" size={16} color={colors.muted} />
              <Text style={{ fontSize: 12.5, color: colors.muted }}>Checking tax, stock, and credit status...</Text>
            </View>
          ) : alertRows.length === 0 && attentionItems.length === 0 ? (
            <View style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            }}>
              <View style={{ width: 32, height: 32, borderRadius: 9, backgroundColor: `${colors.brand}12`, alignItems: 'center', justifyContent: 'center' }}>
                <MaterialCommunityIcons name="check-circle-outline" size={16} color={colors.brand} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Nothing urgent</Text>
                <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>Sales, tax, stock, and credit are caught up.</Text>
              </View>
            </View>
          ) : (
            <>
              {alertRows.slice(0, 2).map((alert) => (
                <AlertRow
                  key={alert.id}
                  cta={alert.action_label || 'Open'}
                  icon={alert.severity === 'critical' ? 'alert-circle-outline' : 'bell-outline'}
                  onPress={() => alert.action_path ? router.push(alert.action_path as never) : router.push('/owner/notifications')}
                  sub={alert.message}
                  title={alert.title}
                  tone={alert.severity === 'critical' ? 'danger' : 'warn'}
                />
              ))}
              {attentionItems.slice(0, Math.max(1, 3 - Math.min(alertRows.length, 2))).map((item) => (
                <AlertRow
                  key={item.kind}
                  cta={item.cta}
                  icon={item.icon}
                  onPress={() => router.push(item.route as never)}
                  sub={item.sub}
                  title={item.title}
                  tone={item.tone}
                />
              ))}
            </>
          )}
        </View>
      </View>

      {/* ── Recent sales ── */}
      <View style={{ paddingHorizontal: 16, paddingTop: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{
            fontSize: 10.5, fontFamily: fonts.bodySemiBold, color: colors.muted,
            textTransform: 'uppercase', letterSpacing: 0.9,
          }}>
            Recent sales
          </Text>
          <TouchableOpacity onPress={() => router.push('/owner/sales')}>
            <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.brand }}>
              See all
            </Text>
          </TouchableOpacity>
        </View>

        <View style={{
          backgroundColor: colors.surface,
          borderWidth: 1, borderColor: colors.border,
          borderRadius: radii.md, overflow: 'hidden',
        }}>
          {recentSales.length === 0 ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ color: colors.muted, fontSize: 13 }}>No sales recorded today yet.</Text>
            </View>
          ) : recentSales.map((sale, i) => {
            const saleRef = `S-${String(sale.id).slice(-4).toUpperCase()}`;
            const itemCount = Array.isArray(sale.items) ? sale.items.length : 0;
            const saleTime = new Date(sale.created_at).toLocaleTimeString('en-GB', {
              hour: 'numeric', minute: '2-digit', hour12: true,
            });
            const isCredit = sale.payment_method === 'credit';

            return (
              <TouchableOpacity
                key={String(sale.id ?? i)}
                onPress={() => sale.id && setSelectedSaleId(String(sale.id))}
                activeOpacity={0.75}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingHorizontal: 14, paddingVertical: 12,
                  borderBottomWidth: i < recentSales.length - 1 ? 1 : 0,
                  borderBottomColor: colors.border,
                }}
              >
                <MethodBadge method={String(sale.payment_method ?? 'cash')} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontSize: 13.5, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {saleRef}{itemCount > 0 ? ` · ${itemCount} item${itemCount > 1 ? 's' : ''}` : ''}
                    {isCredit ? (
                      <Text style={{ color: colors.gold, fontSize: 11, fontFamily: fonts.bodySemiBold }}>
                        {' · credit'}
                      </Text>
                    ) : null}
                  </Text>
                  <Text style={{ fontSize: 11.5, color: colors.muted, marginTop: 1 }}>
                    {saleTime}
                  </Text>
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: colors.ink }}>
                    {ghc(Number(sale.total ?? 0))}
                  </Text>
                  <MaterialCommunityIcons name="chevron-right" size={14} color={colors.border} />
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </ScrollView>

    {/* Sale detail sheet (opened from recent sales) */}
    {selectedSaleId && (
      <SaleDetailSheet
        saleId={selectedSaleId}
        onClose={() => setSelectedSaleId(null)}
      />
    )}
    </SafeAreaView>
  );
}
