'use client';
import { useState } from 'react';
import {
  useTaxSummary,
  useTaxReturns,
  useTaxCalendar,
  useGenerateReturn,
} from '@/hooks/store/useStoreTax';
import { usePlanGate } from '@/hooks/store/usePlanGate';
import {
  PageShell,
  Card,
  StatCard,
  Badge,
  Button,
  EmptyState,
  Spinner,
  Table,
  PlanGateBanner,
  ghs,
} from '@/components/store/kit';
import { toast } from 'sonner';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function TaxPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const gate = usePlanGate('tax_summary');

  const summary = useTaxSummary(year, month);
  const returns = useTaxReturns();
  const calendar = useTaxCalendar(year, month);
  const generate = useGenerateReturn();

  return (
    <PageShell
      title="Tax"
      subtitle="VAT, levies, and GRA returns"
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={selectStyle}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={selectStyle}>
            {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      }
    >
      {!gate.enabled && <PlanGateBanner feature="Tax summary" plan={gate.plan} />}

      {summary.isLoading ? (
        <Spinner />
      ) : summary.data ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 14,
            marginBottom: 22,
          }}
        >
          <StatCard label="VAT output" value={ghs(summary.data.vat_output)} />
          <StatCard label="VAT input" value={ghs(summary.data.vat_input)} />
          <StatCard label="VAT payable" value={ghs(summary.data.vat_payable)} tone="brand" />
          <StatCard label="NHIL" value={ghs(summary.data.nhil)} />
          <StatCard label="GETFund" value={ghs(summary.data.getfund)} />
          <StatCard label="PAYE withheld" value={ghs(summary.data.paye_withheld)} />
          <StatCard label="Total tax" value={ghs(summary.data.total_tax)} tone="warn" />
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        {/* Returns */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <SectionTitle>GRA returns</SectionTitle>
            <Button
              variant="ghost"
              onClick={() => {
                const start = `${year}-${String(month).padStart(2, '0')}-01`;
                const end = new Date(year, month, 0).toISOString().slice(0, 10);
                generate.mutate(
                  { period_type: 'monthly', period_start: start, period_end: end },
                  {
                    onSuccess: () => toast.success('Return generated'),
                    onError: () => toast.error('Could not generate return (KYC may be required)'),
                  }
                );
              }}
            >
              Generate for {MONTHS[month - 1]}
            </Button>
          </div>
          {returns.isLoading ? (
            <Spinner />
          ) : !returns.data || returns.data.length === 0 ? (
            <EmptyState title="No returns generated yet" />
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <Table
                head={['Period', 'Payable', 'Status', 'GRA ref']}
                rows={returns.data.map((r) => [
                  <span key="p" style={{ color: 'var(--ink)' }}>
                    {r.period_start} → {r.period_end}
                  </span>,
                  ghs(r.vat_payable),
                  <Badge key="s" tone={r.status === 'filed' || r.status === 'submitted' ? 'success' : 'default'}>
                    {r.status}
                  </Badge>,
                  r.gra_ref ?? '—',
                ])}
              />
            </div>
          )}
        </Card>

        {/* Calendar */}
        <Card>
          <SectionTitle>Filing calendar · {MONTHS[month - 1]} {year}</SectionTitle>
          {calendar.isLoading ? (
            <Spinner />
          ) : !calendar.data || calendar.data.length === 0 ? (
            <EmptyState title="No deadlines this month" />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {calendar.data.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--sf-bg)',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{c.tax_type}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{c.description}</div>
                  </div>
                  <Badge tone="warn">Due {new Date(c.due_date).toLocaleDateString()}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  height: 38,
  padding: '0 10px',
  borderRadius: 9,
  border: '1px solid var(--sf-line-2)',
  background: 'var(--sf-surface)',
  fontSize: 13,
  color: 'var(--ink)',
};
