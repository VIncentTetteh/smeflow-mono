'use client';
import { useState } from 'react';
import { useCustomers } from '@/hooks/store/useStoreSales';
import { PageShell, Card, Badge, EmptyState, Spinner, Table, ghs, num } from '@/components/store/kit';

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const { data, isLoading } = useCustomers(search);
  const customers = data?.items ?? [];

  const totalOwed = customers.reduce((sum, c) => sum + Number(c.outstanding_credit || 0), 0);

  return (
    <PageShell title="Customers" subtitle={data ? `${num(data.total)} customers` : undefined}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or phone…"
          style={{
            flex: 1,
            height: 38,
            padding: '0 14px',
            borderRadius: 10,
            border: '1.5px solid var(--sf-line-2)',
            background: 'var(--sf-surface)',
            fontSize: 13,
            color: 'var(--ink)',
            outline: 'none',
          }}
        />
      </div>

      {totalOwed > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Card style={{ display: 'inline-block' }}>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Total outstanding credit: </span>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--warn)' }}>{ghs(totalOwed)}</span>
          </Card>
        </div>
      )}

      {isLoading ? (
        <Spinner />
      ) : customers.length === 0 ? (
        <EmptyState title="No customers found" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Customer', 'Phone', 'Purchases', 'Lifetime value', 'Owes', 'Last seen']}
            rows={customers.map((c) => [
              <span key="n" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {c.name ?? 'Walk-in'}
              </span>,
              c.phone ?? '—',
              num(c.purchase_count),
              ghs(c.lifetime_value),
              Number(c.outstanding_credit) > 0 ? (
                <Badge key="o" tone="warn">
                  {ghs(c.outstanding_credit)}
                </Badge>
              ) : (
                '—'
              ),
              c.last_purchase_at ? new Date(c.last_purchase_at).toLocaleDateString() : '—',
            ])}
          />
        </Card>
      )}
    </PageShell>
  );
}
