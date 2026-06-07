import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Text } from '@/components/ui/Text';
import {
  useAnalyticsCashFlow,
  useAnalyticsPnL,
  useAnalyticsSummary,
  useCustomerAnalytics,
  useExportAnalytics,
  useSalesHistory,
  useTopCustomers,
} from '@/api/hooks/featureHooks';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { usePlanGate } from '@/api/hooks/planGate';
import { PlanGatedScreen } from '@/components/ui/PlanGatedScreen';
import * as Linking from 'expo-linking';
import { useTheme } from '@/lib/theme';
import { useAuthStore } from '@/store/auth';
import type { SaleResponseDto } from '@/types/sales';

type Period = '7d' | '30d' | '90d';
type GroupBy = 'day' | 'week' | 'month';
type SortMode = 'revenue' | 'quantity' | 'name';

const PERIOD_DAYS: Record<Period, number> = { '7d': 7, '30d': 30, '90d': 90 };

function ghc(value: number) {
  return `GH₵ ${value.toLocaleString('en-GH', { maximumFractionDigits: 0 })}`;
}

function dateRange(period: Period) {
  const toDate = new Date();
  const fromDate = new Date();
  fromDate.setDate(toDate.getDate() - PERIOD_DAYS[period] + 1);
  return {
    from_date: fromDate.toISOString().slice(0, 10),
    to_date: toDate.toISOString().slice(0, 10),
  };
}

function formatTrendLabel(point: { day?: string; period?: string }, grp: GroupBy): string {
  if (grp === 'day' && point.day) {
    return new Date(point.day).toLocaleDateString('en-GH', { weekday: 'short', day: 'numeric' });
  }
  if (grp === 'week' && point.period) {
    const match = /W(\d+)/.exec(point.period);
    return match ? `Wk ${match[1]}` : point.period;
  }
  if (grp === 'month' && point.period) {
    const [yr, mo] = point.period.split('-');
    return new Date(Number(yr), Number(mo) - 1, 1).toLocaleDateString('en-GH', { month: 'short' });
  }
  return point.day ?? point.period ?? '';
}

export default function AnalyticsScreen() {
  const { colors, fonts } = useTheme();
  const business = useAuthStore((s) => s.business);
  const [period, setPeriod] = useState<Period>('30d');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');
  const [sortMode, setSortMode] = useState<SortMode>('revenue');
  const range = useMemo(() => dateRange(period), [period]);
  const [analyticsTab, setAnalyticsTab] = useState<'overview' | 'finance' | 'customers' | 'benchmarks'>('overview');
  const { allowed: hasBasicAnalytics } = usePlanGate('analytics_basic');
  const { allowed: hasFullAnalytics } = usePlanGate('analytics_full');
  const { allowed: canExport } = usePlanGate('export');
  const pnl = useAnalyticsPnL(analyticsTab === 'finance' && hasFullAnalytics ? range : null);
  const cashFlow = useAnalyticsCashFlow(analyticsTab === 'finance' && hasFullAnalytics ? range : null);
  const topCustomers = useTopCustomers(analyticsTab === 'customers' && hasFullAnalytics ? range : null);
  const customerAnalytics = useCustomerAnalytics(analyticsTab === 'customers' && hasFullAnalytics ? period : null);
  const exportJob = useExportAnalytics();
  const [isExporting, setIsExporting] = useState(false);
  const analytics = useAnalyticsSummary({ period, group_by: groupBy, enabled: hasBasicAnalytics });

  function handleGroupByChange(next: GroupBy) {
    setGroupBy(next);
    if (next === 'week' && period === '7d') setPeriod('30d');
    if (next === 'month' && period !== '90d') setPeriod('90d');
  }
  const sales = useSalesHistory(range);

  const revenuePoints = Array.isArray(analytics.data) ? analytics.data : [];
  const saleRows = Array.isArray(sales.data) ? (sales.data as SaleResponseDto[]) : [];
  const totalRevenue = revenuePoints.reduce((sum, point) =>
    sum + Number(point.revenue ?? point.total_revenue ?? 0), 0);
  const totalSales = saleRows.length;
  const avgSale = totalSales > 0 ? totalRevenue / totalSales : 0;
  const paidSales = saleRows.filter((sale) => sale.status !== 'voided');
  const outstandingCredit = paidSales.reduce((sum, sale) =>
    sum + Number(sale.balance_due ?? 0), 0);

  const trend = revenuePoints.map((point) => ({
    label: formatTrendLabel(point, groupBy),
    value: Number(point.revenue ?? point.total_revenue ?? 0),
  }));
  const maxTrend = Math.max(...trend.map((point) => point.value), 1);
  const midpoint = Math.ceil(trend.length / 2);
  const firstHalf = trend.slice(0, midpoint).reduce((sum, point) => sum + point.value, 0);
  const secondHalf = trend.slice(midpoint).reduce((sum, point) => sum + point.value, 0);
  const trendChange = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : null;

  const methodMix = ['cash', 'momo', 'credit', 'mixed'].map((method) => {
    const rows = saleRows.filter((sale) => sale.payment_method === method);
    const value = rows.reduce((sum, sale) => sum + Number(sale.total ?? 0), 0);
    return { method, count: rows.length, value };
  }).filter((row) => row.count > 0 || row.value > 0);
  const maxMethod = Math.max(...methodMix.map((row) => row.value), 1);

  const topSellers = (() => {
    const itemMap = new Map<string, { name: string; qty: number; revenue: number }>();
    saleRows.forEach((sale) => {
      (sale.items ?? []).forEach((item) => {
        const name = item.description ?? 'Unknown item';
        const current = itemMap.get(name) ?? { name, qty: 0, revenue: 0 };
        current.qty += Number(item.qty ?? 0);
        current.revenue += Number(item.line_total ?? 0);
        itemMap.set(name, current);
      });
    });
    return Array.from(itemMap.values())
      .sort((a, b) => {
        if (sortMode === 'quantity') return b.qty - a.qty;
        if (sortMode === 'name') return a.name.localeCompare(b.name);
        return b.revenue - a.revenue;
      })
      .slice(0, 8);
  })();
  const maxSeller = Math.max(...topSellers.map((item) => sortMode === 'quantity' ? item.qty : item.revenue), 1);
  const isLoading = analytics.isLoading || sales.isLoading;

  function handleExport() {
    if (!canExport) {
      Alert.alert('Export requires Pro', 'Upgrade to Pro to export analytics reports.');
      return;
    }
    setIsExporting(true);
    exportJob.mutate(
      { report: 'revenue', format: 'xlsx', group_by: groupBy, ...range },
      {
        onSuccess: (url) => {
          setIsExporting(false);
          void Linking.openURL(url);
        },
        onError: (e: Error) => {
          setIsExporting(false);
          Alert.alert('Export failed', e.message ?? 'Could not export. Try again.');
        },
      }
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        backgroundColor: colors.surface,
        flexDirection: 'row',
        alignItems: 'center',
      }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 20, color: colors.ink }}>Analytics</Text>
          <Text style={{ fontSize: 12, color: colors.muted }}>{business?.name ?? 'Your business'} · revenue, mix, trends</Text>
        </View>
        <TouchableOpacity onPress={handleExport} disabled={isExporting} hitSlop={8} style={{ padding: 6 }}>
          {isExporting
            ? <ActivityIndicator size="small" color={colors.brand} />
            : <MaterialCommunityIcons name={canExport ? 'share-outline' : 'lock-outline'} size={20} color={canExport ? colors.muted : colors.gold} />}
        </TouchableOpacity>
      </View>

      <PlanGatedScreen feature="analytics_basic">
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 14 }}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['7d', '30d', '90d'] as Period[]).map((item) => {
            const selected = period === item;
            return (
              <TouchableOpacity
                key={item}
                onPress={() => setPeriod(item)}
                style={{
                  paddingHorizontal: 13,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.ink : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: selected ? '#fdf7eb' : colors.muted }}>
                  {item === '7d' ? '7 days' : item === '30d' ? '30 days' : '90 days'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([
            { key: 'day',   label: 'Day' },
            { key: 'week',  label: 'Week' },
            { key: 'month', label: 'Month' },
          ] as { key: GroupBy; label: string }[]).map((item) => {
            const selected = groupBy === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => handleGroupByChange(item.key)}
                style={{
                  paddingHorizontal: 13,
                  paddingVertical: 6,
                  borderRadius: 999,
                  backgroundColor: selected ? colors.brand : colors.surface,
                  borderWidth: selected ? 0 : 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: selected ? '#fff' : colors.muted }}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Analytics section tabs */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['overview', 'finance', 'customers', 'benchmarks'] as const).map((tab) => {
            const sel = analyticsTab === tab;
            const label = tab === 'overview' ? 'Overview' : tab === 'finance' ? 'Finance' : tab === 'customers' ? 'Customers' : 'Benchmarks';
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setAnalyticsTab(tab)}
                style={{
                  paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999,
                  backgroundColor: sel ? colors.brand : colors.surface,
                  borderWidth: sel ? 0 : 1, borderColor: colors.border,
                }}
              >
                <Text style={{ fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: sel ? '#fff' : colors.muted }}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {analyticsTab === 'overview' && (
          <>
        {isLoading ? (
          <View style={{ paddingVertical: 32, alignItems: 'center' }}>
            <ActivityIndicator color={colors.brand} />
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {[
            { label: 'Revenue', value: ghc(totalRevenue), icon: 'chart-line' },
            { label: 'Sales', value: String(totalSales), icon: 'receipt-text-outline' },
            { label: 'Avg sale', value: ghc(avgSale), icon: 'calculator-variant-outline' },
            { label: 'Credit due', value: ghc(outstandingCredit), icon: 'cash-clock' },
          ].map((metric) => (
            <View
              key={metric.label}
              style={{
                width: '48%',
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                padding: 12,
              }}
            >
              <MaterialCommunityIcons name={metric.icon as never} size={16} color={colors.muted} />
              <Text style={{ fontSize: 10.5, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 8 }}>
                {metric.label}
              </Text>
              <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 18, color: colors.ink, marginTop: 2 }}>
                {metric.value}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ flex: 1, fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink }}>Revenue trend</Text>
            {trendChange !== null ? (
              <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: trendChange >= 0 ? colors.brand : colors.danger }}>
                {trendChange >= 0 ? '+' : ''}{trendChange}%
              </Text>
            ) : null}
          </View>
          {trend.length === 0 ? (
            <View style={{ height: 120, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 12, color: colors.muted }}>No revenue data yet</Text>
            </View>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 120, gap: 4 }}>
                {trend.map((point, index) => (
                  <View key={`${point.label}-${index}`} style={{ flex: 1, justifyContent: 'flex-end' }}>
                    <View style={{
                      height: Math.max(4, Math.round((point.value / maxTrend) * 112)),
                      borderRadius: 4,
                      backgroundColor: index === trend.length - 1 ? colors.brand : `${colors.ink}18`,
                    }} />
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ fontSize: 10.5, color: colors.muted }}>{range.from_date}</Text>
                <Text style={{ fontSize: 10.5, color: colors.muted }}>{range.to_date}</Text>
              </View>
            </>
          )}
        </View>

        <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 14, gap: 9 }}>
          <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 15, color: colors.ink }}>Payment mix</Text>
          {methodMix.length === 0 ? (
            <Text style={{ fontSize: 12, color: colors.muted }}>No payment data in this period.</Text>
          ) : methodMix.map((row) => (
            <View key={row.method}>
              <View style={{ flexDirection: 'row', marginBottom: 4 }}>
                <Text style={{ flex: 1, fontSize: 12.5, fontFamily: fonts.bodySemiBold, color: colors.ink, textTransform: 'capitalize' }}>{row.method}</Text>
                <Text style={{ fontSize: 12, color: colors.muted }}>{row.count} · {ghc(row.value)}</Text>
              </View>
              <View style={{ height: 5, borderRadius: 3, backgroundColor: `${colors.ink}08`, overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(4, (row.value / maxMethod) * 100)}%` as never, height: '100%' as never, backgroundColor: colors.brand }} />
              </View>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, fontSize: 11, color: colors.muted, fontFamily: fonts.bodySemiBold, textTransform: 'uppercase', letterSpacing: 0.7 }}>
            Top sellers
          </Text>
          {([
            { key: 'revenue', label: 'Revenue' },
            { key: 'quantity', label: 'Qty' },
            { key: 'name', label: 'A-Z' },
          ] as const).map((item) => {
            const selected = sortMode === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                onPress={() => setSortMode(item.key)}
                style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: selected ? colors.ink : 'transparent' }}
              >
                <Text style={{ fontSize: 11, fontFamily: fonts.bodySemiBold, color: selected ? '#fdf7eb' : colors.muted }}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {topSellers.length === 0 ? (
          <View style={{ paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ fontSize: 12, color: colors.muted }}>No item-level sales in this period.</Text>
          </View>
        ) : topSellers.map((item) => {
          const basis = sortMode === 'quantity' ? item.qty : item.revenue;
          return (
            <View key={item.name} style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{item.name}</Text>
                <Text style={{ fontSize: 11.5, color: colors.muted }}>{item.qty} sold</Text>
                <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 12.5, color: colors.ink }}>{ghc(item.revenue)}</Text>
              </View>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: `${colors.ink}08`, overflow: 'hidden', marginTop: 8 }}>
                <View style={{ width: `${Math.max(5, (basis / maxSeller) * 100)}%` as never, height: '100%' as never, backgroundColor: colors.brand }} />
              </View>
            </View>
          );
        })}
          </>
        )}

        {analyticsTab === 'finance' && !hasFullAnalytics ? (
          <UpgradePrompt
            feature="Finance analytics"
            requiredPlan="pro"
            description="Pro unlocks profit and loss, cash flow, and deeper financial analysis."
          />
        ) : null}

        {analyticsTab === 'finance' && hasFullAnalytics && (
          <>
            {/* P&L Card */}
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginBottom: 12 }}>Profit & Loss</Text>
              {pnl.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />}
              {pnl.isError && (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>Could not load P&L data</Text>
                  <TouchableOpacity onPress={() => void pnl.refetch()} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
              {pnl.data && (
                <>
                  {[
                    { label: 'Revenue', value: pnl.data.revenue, bold: false },
                    { label: 'Cost of goods', value: pnl.data.cogs, bold: false },
                    { label: 'Gross profit', value: pnl.data.gross_profit, bold: true },
                  ].map((row) => (
                    <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                      <Text style={{ fontSize: 13, fontFamily: row.bold ? fonts.bodySemiBold : fonts.body, color: row.bold ? colors.brand : colors.ink }}>
                        {ghc(row.value)}
                      </Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Gross margin</Text>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{pnl.data.gross_margin_pct.toFixed(1)}%</Text>
                  </View>
                </>
              )}
            </View>

            {/* Cash Flow Card */}
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, padding: 16 }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, marginBottom: 12 }}>Cash Flow</Text>
              {cashFlow.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />}
              {cashFlow.isError && (
                <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>Could not load cash flow data</Text>
                  <TouchableOpacity onPress={() => void cashFlow.refetch()} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
              {cashFlow.data && (
                <>
                  {[
                    { label: 'Cash collected', value: Number(cashFlow.data.cash_inflow), bold: false },
                    { label: 'MoMo collected', value: Number(cashFlow.data.momo_inflow), bold: false },
                    { label: 'Total inflow', value: Number(cashFlow.data.total_inflow), bold: true },
                  ].map((row) => (
                    <View key={row.label} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                      <Text style={{ fontSize: 13, color: colors.muted }}>{row.label}</Text>
                      <Text style={{ fontSize: 13, fontFamily: row.bold ? fonts.bodySemiBold : fonts.body, color: row.bold ? colors.brand : colors.ink }}>
                        {ghc(row.value)}
                      </Text>
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10 }}>
                    <Text style={{ fontSize: 12, color: colors.muted }}>Outstanding credit</Text>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: '#b6831e' }}>{ghc(Number(cashFlow.data.outstanding_credit))}</Text>
                  </View>
                </>
              )}
            </View>
          </>
        )}

        {analyticsTab === 'customers' && !hasFullAnalytics ? (
          <UpgradePrompt
            feature="Customer analytics"
            requiredPlan="pro"
            description="Pro unlocks customer ranking, repeat-purchase stats, and outstanding balance insights."
          />
        ) : null}

        {analyticsTab === 'customers' && hasFullAnalytics && (
          <>
            {/* Stats row — computed from customerAnalytics */}
            {customerAnalytics.data && customerAnalytics.data.length > 0 && (() => {
              const rows = customerAnalytics.data;
              const totalSpent = rows.reduce((s, r) => s + Number(r.total_spent), 0);
              const totalPurchases = rows.reduce((s, r) => s + r.purchase_count, 0);
              const avgOrderValue = totalPurchases > 0 ? totalSpent / totalPurchases : 0;
              const repeatCount = rows.filter((r) => r.purchase_count > 1).length;
              const repeatPct = rows.length > 0 ? Math.round((repeatCount / rows.length) * 100) : 0;
              return (
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[
                    { label: 'Customers', value: String(rows.length) },
                    { label: 'Avg order', value: ghc(avgOrderValue) },
                    { label: 'Repeat', value: `${repeatPct}%` },
                  ].map((stat) => (
                    <View key={stat.label} style={{ flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 12, alignItems: 'center' }}>
                      <Text style={{ fontSize: 16, fontFamily: fonts.displaySemiBold, color: colors.ink }}>{stat.value}</Text>
                      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{stat.label}</Text>
                    </View>
                  ))}
                </View>
              );
            })()}

            {/* Top customers list */}
            <View style={{ backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden' }}>
              <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink, padding: 14, paddingBottom: 10 }}>Top Customers</Text>
              {topCustomers.isLoading && <ActivityIndicator color={colors.brand} style={{ marginVertical: 20 }} />}
              {topCustomers.isError && (
                <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                  <Text style={{ fontSize: 13, color: colors.muted }}>Could not load customers</Text>
                  <TouchableOpacity onPress={() => void topCustomers.refetch()} style={{ marginTop: 8, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ fontSize: 12, fontFamily: fonts.bodySemiBold, color: colors.ink }}>Retry</Text>
                  </TouchableOpacity>
                </View>
              )}
              {!topCustomers.isLoading && !topCustomers.isError && (topCustomers.data ?? []).length === 0 && (
                <Text style={{ fontSize: 13, color: colors.muted, textAlign: 'center', paddingVertical: 20 }}>No customer data for this period.</Text>
              )}
              {(topCustomers.data ?? []).map((customer, i) => (
                <View
                  key={customer.customer_id}
                  style={{
                    flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12,
                    borderTopWidth: i === 0 ? 1 : 0, borderTopColor: colors.border,
                    borderBottomWidth: i < (topCustomers.data ?? []).length - 1 ? 1 : 0,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ width: 26, alignItems: 'center' }}>
                    <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.bodySemiBold }}>#{i + 1}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }} numberOfLines={1}>{customer.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.muted }}>{customer.purchase_count} purchase{customer.purchase_count !== 1 ? 's' : ''}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={{ fontSize: 13, fontFamily: fonts.bodySemiBold, color: colors.ink }}>{ghc(Number(customer.total_spent))}</Text>
                    {Number(customer.outstanding) > 0 && (
                      <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: '#fff5cc' }}>
                        <Text style={{ fontSize: 10, color: '#b6831e', fontFamily: fonts.bodySemiBold }}>
                          {ghc(Number(customer.outstanding))} owed
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
        {/* ── BENCHMARKS TAB ── */}
        {analyticsTab === 'benchmarks' && (
          <View style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            {/* Teaser card — always shown until feature flag enables live data */}
            <View style={{
              backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
              borderRadius: 16, padding: 20, gap: 14,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: `${colors.brand}18`, alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={22} color={colors.brand} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: fonts.displaySemiBold, fontSize: 16, color: colors.ink }}>Industry benchmarks</Text>
                  <Text style={{ fontSize: 12, color: colors.muted, marginTop: 2 }}>Coming soon</Text>
                </View>
              </View>
              <Text style={{ fontSize: 13, color: colors.muted, lineHeight: 20 }}>
                See how your business compares to similar shops in Ghana — anonymously. We'll show average margins, revenue per sale, and top-selling categories for your industry (retail, food & beverage, or services).
              </Text>

              {/* Placeholder comparison bars */}
              {[
                { label: 'Gross margin', yours: 38, industry: 31 },
                { label: 'Avg sale value', yours: 55, industry: 48 },
                { label: 'Daily transactions', yours: 22, industry: 18 },
              ].map((row) => (
                <View key={row.label} style={{ gap: 6 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 12, color: colors.muted, fontFamily: fonts.bodySemiBold }}>{row.label}</Text>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <Text style={{ fontSize: 11, color: colors.brand }}>You</Text>
                      <Text style={{ fontSize: 11, color: colors.muted }}>Industry avg</Text>
                    </View>
                  </View>
                  <View style={{ gap: 4 }}>
                    {/* Your bar */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1, height: 8, backgroundColor: `${colors.brand}18`, borderRadius: 4, overflow: 'hidden' }}>
                        <View style={{ width: `${row.yours}%`, height: '100%', backgroundColor: colors.brand, borderRadius: 4 }} />
                      </View>
                      <Text style={{ fontSize: 11, color: colors.brand, width: 30, textAlign: 'right', fontFamily: fonts.bodySemiBold }}>{row.yours}%</Text>
                    </View>
                    {/* Industry bar */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View style={{ flex: 1, height: 8, backgroundColor: `${colors.border}`, borderRadius: 4, overflow: 'hidden' }}>
                        <View style={{ width: `${row.industry}%`, height: '100%', backgroundColor: colors.muted, borderRadius: 4, opacity: 0.4 }} />
                      </View>
                      <Text style={{ fontSize: 11, color: colors.muted, width: 30, textAlign: 'right' }}>{row.industry}%</Text>
                    </View>
                  </View>
                </View>
              ))}

              <View style={{ borderRadius: 10, backgroundColor: `${colors.brand}10`, padding: 12 }}>
                <Text style={{ fontSize: 12, color: colors.brand, lineHeight: 18 }}>
                  We're building the anonymised dataset now. Benchmarks will go live once we have enough participating businesses in your industry to report meaningfully.
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
      </PlanGatedScreen>
    </SafeAreaView>
  );
}
