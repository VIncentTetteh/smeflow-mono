'use client';
import { useMemo, useState } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import {
  useRevenueTrend,
  useTopItems,
  usePnl,
  useCashFlow,
} from '@/hooks/store/useStoreAnalytics';
import { usePlanGate } from '@/hooks/store/usePlanGate';
import {
  PageShell,
  Card,
  StatCard,
  EmptyState,
  Spinner,
  PlanGateBanner,
  ghs,
  num,
} from '@/components/store/kit';

const PERIODS: [string, string][] = [
  ['7d', 'Last 7 days'],
  ['30d', 'Last 30 days'],
  ['90d', 'Last 90 days'],
];

export default function AnalyticsPage() {
  const [period, setPeriod] = useState('30d');
  const gate = usePlanGate('analytics');

  const { from, to } = useMemo(() => {
    const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;
    const toDate = new Date();
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - days);
    return { from: fromDate.toISOString().slice(0, 10), to: toDate.toISOString().slice(0, 10) };
  }, [period]);

  const revenue = useRevenueTrend(period);
  const topItems = useTopItems(period);
  const pnl = usePnl(from, to);
  const cashFlow = useCashFlow(from, to);

  const revenueData = (revenue.data ?? []).map((p) => ({
    day: p.day?.slice(5) ?? '',
    revenue: Number(p.revenue),
  }));

  const topData = (topItems.data ?? []).slice(0, 8).map((t) => ({
    name: t.name?.length > 12 ? t.name.slice(0, 12) + '…' : t.name,
    revenue: Number(t.revenue),
  }));

  return (
    <PageShell
      title="Analytics"
      subtitle="Revenue, profit, and top performers"
      actions={
        <div style={{ display: 'flex', gap: 4 }}>
          {PERIODS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setPeriod(key)}
              style={{
                all: 'unset',
                cursor: 'pointer',
                padding: '7px 12px',
                borderRadius: 9,
                fontSize: 12.5,
                fontWeight: 600,
                color: period === key ? 'var(--brand)' : 'var(--ink-3)',
                background: period === key ? 'var(--brand-soft)' : 'transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {!gate.enabled && <PlanGateBanner feature="Advanced analytics" plan={gate.plan} />}

      {/* P&L KPIs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <StatCard label="Revenue" value={ghs(pnl.data?.revenue ?? 0)} tone="brand" />
        <StatCard label="Cost of goods" value={ghs(pnl.data?.cogs ?? 0)} />
        <StatCard
          label="Gross profit"
          value={ghs(pnl.data?.gross_profit ?? 0)}
          tone="success"
          hint={pnl.data ? `${pnl.data.gross_margin_pct}% margin` : undefined}
        />
        <StatCard
          label="Operating expenses"
          value={ghs(pnl.data?.operating_expenses ?? 0)}
          hint={
            pnl.data && (pnl.data.operating_expenses ?? 0) === 0
              ? 'None recorded yet'
              : undefined
          }
        />
        <StatCard
          label="Net profit"
          value={ghs(pnl.data?.net_profit ?? 0)}
          tone={Number(pnl.data?.net_profit ?? 0) < 0 ? 'warn' : 'success'}
          hint={pnl.data ? `${pnl.data.net_margin_pct}% margin` : undefined}
        />
        <StatCard
          label="Outstanding credit"
          value={ghs(cashFlow.data?.outstanding_credit ?? 0)}
          tone={Number(cashFlow.data?.outstanding_credit ?? 0) > 0 ? 'warn' : 'default'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {/* Revenue trend */}
        <Card>
          <ChartTitle>Revenue trend</ChartTitle>
          {revenue.isLoading ? (
            <Spinner />
          ) : revenueData.length === 0 ? (
            <EmptyState title="No revenue in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={revenueData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                <Tooltip
                  formatter={(v: unknown) => ghs(Number(v))}
                  contentStyle={{
                    background: 'var(--sf-surface)',
                    border: '1px solid var(--sf-line)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="revenue" stroke="var(--brand)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Top items */}
        <Card>
          <ChartTitle>Top items by revenue</ChartTitle>
          {topItems.isLoading ? (
            <Spinner />
          ) : topData.length === 0 ? (
            <EmptyState title="No item sales in this period" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={topData} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--ink-3)' }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--ink-3)' }} />
                <Tooltip
                  formatter={(v: unknown) => ghs(Number(v))}
                  contentStyle={{
                    background: 'var(--sf-surface)',
                    border: '1px solid var(--sf-line)',
                    borderRadius: 10,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="revenue" fill="var(--brand)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Cash flow */}
        <Card>
          <ChartTitle>Cash flow ({period})</ChartTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <FlowRow label="Cash inflow" value={ghs(cashFlow.data?.cash_inflow ?? 0)} />
            <FlowRow label="MoMo inflow" value={ghs(cashFlow.data?.momo_inflow ?? 0)} />
            <FlowRow label="Total inflow" value={ghs(cashFlow.data?.total_inflow ?? 0)} strong />
            <FlowRow label="Money paid out" value={ghs(cashFlow.data?.total_outflow ?? 0)} />
            <FlowRow label="Net cash flow" value={ghs(cashFlow.data?.net_cash_flow ?? 0)} strong />
            <FlowRow label="Outstanding credit" value={ghs(cashFlow.data?.outstanding_credit ?? 0)} tone="warn" />
            <FlowRow label="Transactions" value={num(cashFlow.data?.total_sales ?? 0)} />
          </div>
        </Card>

        {/* Expenses by category */}
        <Card>
          <ChartTitle>Operating expenses by category</ChartTitle>
          {pnl.isLoading ? (
            <Spinner />
          ) : (pnl.data?.expenses_by_category ?? []).length === 0 ? (
            <EmptyState title="No expenses recorded in this period" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(pnl.data?.expenses_by_category ?? []).map((row) => (
                <FlowRow key={row.category} label={row.label} value={ghs(row.total)} />
              ))}
              <FlowRow
                label="Total"
                value={ghs(pnl.data?.operating_expenses ?? 0)}
                strong
              />
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}

function ChartTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function FlowRow({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'warn';
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingBottom: 8,
        borderBottom: '1px solid var(--sf-line)',
      }}
    >
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{label}</span>
      <span
        style={{
          fontSize: strong ? 15 : 13,
          fontWeight: strong ? 700 : 600,
          color: tone === 'warn' ? 'var(--warn)' : 'var(--ink)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </span>
    </div>
  );
}
