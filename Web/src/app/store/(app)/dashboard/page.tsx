'use client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStoreDashboard } from '@/hooks/store/useStoreDashboard';
import { useSSE } from '@/hooks/useSSE';
import { useStoreAuth } from '@/stores/authStore';
import { PageShell, Card, StatCard, Badge, EmptyState, Spinner, ghs, num } from '@/components/store/kit';

export default function StoreDashboardPage() {
  const { data, isLoading, isError } = useStoreDashboard();
  const businessId = useStoreAuth((s) => s.businessId);
  const queryClient = useQueryClient();

  // Live alerts: refresh the aggregate and surface a toast when the backend pushes an event.
  useSSE(businessId, (event) => {
    toast(event.message ?? 'New activity');
    queryClient.invalidateQueries({ queryKey: ['store', 'dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['store', 'notifications', 'alerts'] });
  });

  if (isLoading) {
    return (
      <PageShell title="Dashboard">
        <Spinner label="Loading your store…" />
      </PageShell>
    );
  }
  if (isError || !data) {
    return (
      <PageShell title="Dashboard">
        <EmptyState title="Could not load your dashboard" hint="Please refresh to try again." />
      </PageShell>
    );
  }

  const d = data.daily_summary;
  const alerts = data.alerts?.items ?? [];
  const lowStock = data.low_stock_preview ?? [];

  return (
    <PageShell title="Dashboard" subtitle={`Today · ${data.generated_at}`}>
      {/* KPI row */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <StatCard label="Revenue today" value={ghs(d?.total_revenue ?? 0)} tone="brand" />
        <StatCard label="Sales today" value={num(d?.total_sales ?? 0)} />
        <StatCard label="Cash" value={ghs(d?.cash_revenue ?? 0)} />
        <StatCard label="MoMo" value={ghs(d?.momo_revenue ?? 0)} />
        <StatCard
          label="On credit"
          value={ghs(d?.credit_revenue ?? 0)}
          tone={(d?.credit_revenue ?? 0) > 0 ? 'warn' : 'default'}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: 16,
        }}
      >
        {/* Attention / alerts */}
        <Card>
          <SectionTitle>Needs attention</SectionTitle>
          {alerts.length === 0 ? (
            <MutedRow>Nothing needs your attention right now.</MutedRow>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {alerts.map((a) => (
                <div
                  key={a.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--sf-bg)',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                      {a.title ?? 'Alert'}
                    </div>
                    {a.body && (
                      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{a.body}</div>
                    )}
                  </div>
                  {a.severity && (
                    <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : 'default'}>
                      {a.severity}
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Low stock */}
        <Card>
          <SectionTitle>Low stock</SectionTitle>
          {lowStock.length === 0 ? (
            <MutedRow>All items are above their thresholds.</MutedRow>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lowStock.map((it) => (
                <div
                  key={it.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--sf-bg)',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{it.name}</span>
                  <Badge tone="danger">
                    {num(it.current_stock)} / {num(it.low_stock_threshold)}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Top items today */}
        <Card>
          <SectionTitle>Top sellers today</SectionTitle>
          {(d?.top_items ?? []).length === 0 ? (
            <MutedRow>No sales recorded yet today.</MutedRow>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(d?.top_items ?? []).slice(0, 6).map((t, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderRadius: 10,
                    background: 'var(--sf-bg)',
                  }}
                >
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{t.name ?? 'Item'}</span>
                  <span style={{ fontSize: 12.5, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
                    {t.qty != null ? `${num(t.qty)} sold` : ''} {t.revenue != null ? `· ${ghs(t.revenue)}` : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Credit + tax snapshot */}
        <Card>
          <SectionTitle>Business health</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Row label="Credit score">
              {data.credit_score?.score != null ? (
                <Badge tone="brand">
                  {data.credit_score.score} {data.credit_score.band ? `· ${data.credit_score.band}` : ''}
                </Badge>
              ) : (
                <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Not available</span>
              )}
            </Row>
            <Row label="VAT payable">
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                {ghs(data.tax_summary?.vat_payable ?? 0)}
              </span>
            </Row>
            {data.tax_summary?.filing_readiness && (
              <Row label="Filing status">
                <Badge>{data.tax_summary.filing_readiness}</Badge>
              </Row>
            )}
          </div>
        </Card>
      </div>
    </PageShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

function MutedRow({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 12.5, color: 'var(--ink-3)', padding: '4px 0' }}>{children}</div>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{label}</span>
      {children}
    </div>
  );
}
