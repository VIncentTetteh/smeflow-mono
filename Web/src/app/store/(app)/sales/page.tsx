'use client';
import { useSales, useDailySummary, useVoidSale } from '@/hooks/store/useStoreSales';
import { useCanManage } from '@/hooks/store/useRole';
import {
  PageShell,
  Card,
  StatCard,
  Badge,
  Button,
  EmptyState,
  Spinner,
  Table,
  ghs,
  num,
} from '@/components/store/kit';

export default function SalesPage() {
  const { data: summary } = useDailySummary();
  const { data: sales, isLoading } = useSales();
  const voidSale = useVoidSale();
  const canManage = useCanManage();

  return (
    <PageShell title="Sales" subtitle="Today's takings and recent transactions">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        <StatCard label="Revenue today" value={ghs(summary?.total_revenue ?? 0)} tone="brand" />
        <StatCard label="Transactions" value={num(summary?.total_sales ?? 0)} />
        <StatCard label="Cash" value={ghs(summary?.cash_revenue ?? 0)} />
        <StatCard label="MoMo" value={ghs(summary?.momo_revenue ?? 0)} />
        <StatCard
          label="On credit"
          value={ghs(summary?.credit_revenue ?? 0)}
          tone={Number(summary?.credit_revenue ?? 0) > 0 ? 'warn' : 'default'}
        />
      </div>

      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 10 }}>
        Recent sales
      </div>

      {isLoading ? (
        <Spinner />
      ) : !sales || sales.length === 0 ? (
        <EmptyState title="No sales recorded" hint="Sales recorded in the app appear here." />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['When', 'Method', 'Total', 'Paid', 'Balance', 'Status', canManage ? '' : '']}
            rows={sales.map((s) => [
              <span key="t" style={{ color: 'var(--ink)' }}>
                {new Date(s.created_at).toLocaleString('en-GH', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>,
              <Badge key="m">{s.payment_method}</Badge>,
              <span key="tot" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {ghs(s.total)}
              </span>,
              ghs(s.amount_paid),
              Number(s.balance_due) > 0 ? (
                <span key="b" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                  {ghs(s.balance_due)}
                </span>
              ) : (
                ghs(0)
              ),
              <Badge key="st" tone={s.status === 'voided' ? 'danger' : s.status === 'paid' ? 'success' : 'default'}>
                {s.status}
              </Badge>,
              canManage && s.status !== 'voided' ? (
                <div key="a" style={{ textAlign: 'right' }}>
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm('Void this sale? This cannot be undone.')) voidSale.mutate(s.id);
                    }}
                  >
                    Void
                  </Button>
                </div>
              ) : (
                ''
              ),
            ])}
          />
        </Card>
      )}
    </PageShell>
  );
}
