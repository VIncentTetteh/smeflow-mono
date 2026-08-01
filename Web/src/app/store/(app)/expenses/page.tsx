'use client';
import { useMemo, useState } from 'react';
import {
  useDeleteExpense,
  useExpenseCategories,
  useExpenseSummary,
  useExpenses,
  useRecordExpense,
  type ExpenseCreate,
  type ExpensePaymentMethod,
} from '@/hooks/store/useStoreExpenses';
import { useCanManage } from '@/hooks/store/useRole';
import {
  PageShell,
  Card,
  StatCard,
  Button,
  Badge,
  EmptyState,
  Spinner,
  Table,
  ghs,
} from '@/components/store/kit';
import { Modal, Field, TextInput, Select } from '@/components/store/Modal';

const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'momo', label: 'Mobile Money' },
  { value: 'bank', label: 'Bank' },
  { value: 'credit', label: 'Owing (not yet paid)' },
  { value: 'other', label: 'Other' },
];

/** First and last day of the month `offset` months back from today. */
function monthRange(offset: number) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - offset, 1);
  const end = new Date(now.getFullYear(), now.getMonth() - offset + 1, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return {
    from: iso(start),
    to: iso(end),
    label: start.toLocaleDateString('en-GH', { month: 'long', year: 'numeric' }),
  };
}

export default function ExpensesPage() {
  const [monthOffset, setMonthOffset] = useState(0);
  const range = useMemo(() => monthRange(monthOffset), [monthOffset]);

  const summary = useExpenseSummary(range.from, range.to);
  const expenses = useExpenses(range.from, range.to);
  const record = useRecordExpense();
  const remove = useDeleteExpense();
  const canManage = useCanManage();

  const [showAdd, setShowAdd] = useState(false);
  const items = expenses.data?.items ?? [];

  return (
    <PageShell
      title="Expenses"
      subtitle="What the business spends — this is what turns gross profit into real profit"
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <Button variant="ghost" onClick={() => setMonthOffset((m) => m + 1)}>
              ←
            </Button>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--ink-2)',
                minWidth: 110,
                textAlign: 'center',
              }}
            >
              {range.label}
            </span>
            <Button
              variant="ghost"
              disabled={monthOffset === 0}
              onClick={() => setMonthOffset((m) => Math.max(0, m - 1))}
            >
              →
            </Button>
          </div>
          {canManage && <Button onClick={() => setShowAdd(true)}>+ Record expense</Button>}
        </div>
      }
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 14,
          marginBottom: 20,
        }}
      >
        <StatCard label="Total spent" value={ghs(summary.data?.total ?? 0)} tone="brand" />
        <StatCard
          label="Counts against profit"
          value={ghs(summary.data?.operating_total ?? 0)}
          hint="Operating expenses"
        />
        <StatCard
          label="Excluded"
          value={ghs(summary.data?.excluded_total ?? 0)}
          hint="Stock cost & drawings"
        />
        <StatCard label="Entries" value={String(summary.data?.count ?? 0)} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Card>
          <SectionTitle>Where the money went</SectionTitle>
          {summary.isLoading ? (
            <Spinner />
          ) : (summary.data?.by_category ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 0' }}>
              Nothing recorded for {range.label} yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {(summary.data?.by_category ?? []).map((row) => {
                const share = summary.data?.total ? (row.total / summary.data.total) * 100 : 0;
                return (
                  <div key={row.category}>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 5,
                      }}
                    >
                      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                        {row.label}
                        {row.kind !== 'operating' && (
                          <span style={{ marginLeft: 6 }}>
                            <Badge>excluded</Badge>
                          </span>
                        )}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          fontWeight: 600,
                          color: 'var(--ink)',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {ghs(row.total)}
                      </span>
                    </div>
                    <div style={{ height: 5, borderRadius: 3, background: 'var(--sf-sunken)' }}>
                      <div
                        style={{
                          height: 5,
                          borderRadius: 3,
                          width: `${Math.min(100, share)}%`,
                          background: row.kind === 'operating' ? 'var(--brand)' : 'var(--ink-3)',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {(summary.data?.excluded_total ?? 0) > 0 && (
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  Excluded categories do not reduce net profit — stock cost is already counted in cost
                  of goods, and owner drawings are not a business cost.
                </div>
              )}
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>How it was paid</SectionTitle>
          {summary.isLoading ? (
            <Spinner />
          ) : (summary.data?.by_payment_method ?? []).length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', padding: '8px 0' }}>No payments yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {(summary.data?.by_payment_method ?? []).map((row) => (
                <div
                  key={row.payment_method}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    paddingBottom: 8,
                    borderBottom: '1px solid var(--sf-line)',
                  }}
                >
                  <span style={{ fontSize: 12.5, color: 'var(--ink-2)', textTransform: 'capitalize' }}>
                    {row.payment_method}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--ink)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {ghs(row.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 20 }}>
        {expenses.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState
            title="No expenses recorded"
            hint="Record rent, transport, bills and wages to see what you actually made."
          />
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Table
              head={['Date', 'Category', 'Paid to', 'Method', 'Amount', canManage ? '' : '']}
              rows={items.map((e) => [
                new Date(e.expense_date).toLocaleDateString('en-GH', {
                  day: 'numeric',
                  month: 'short',
                }),
                <div key="c">
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{e.category_label}</div>
                  {!e.is_editable && (
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>from payroll</div>
                  )}
                  {e.notes && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{e.notes}</div>}
                </div>,
                e.vendor_name ?? '—',
                <Badge key="m">{e.payment_method}</Badge>,
                <span key="a" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                  {ghs(e.amount)}
                </span>,
                canManage && e.is_editable ? (
                  <Button
                    key="d"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete this ${e.category_label} expense of ${ghs(e.amount)}?`)) {
                        remove.mutate(e.id);
                      }
                    }}
                  >
                    Delete
                  </Button>
                ) : (
                  ''
                ),
              ])}
            />
          </Card>
        )}
      </div>

      {showAdd && (
        <AddExpenseModal
          saving={record.isPending}
          onClose={() => setShowAdd(false)}
          onSave={async (body) => {
            await record.mutateAsync(body);
            setShowAdd(false);
          }}
        />
      )}
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
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  );
}

function AddExpenseModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: ExpenseCreate) => Promise<void>;
}) {
  const categories = useExpenseCategories();
  const [category, setCategory] = useState('rent');
  const [amount, setAmount] = useState('');
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod>('cash');
  const [vendorName, setVendorName] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const options = categories.data ?? [];
  const selected = options.find((c) => c.key === category);

  return (
    <Modal
      title="Record an expense"
      onClose={onClose}
      saving={saving}
      error={error}
      submitLabel="Save expense"
      onSubmit={() => {
        const value = Number(amount);
        if (!value || value <= 0) {
          setError('Enter an amount greater than zero.');
          return;
        }
        if (!expenseDate) {
          setError('Pick a date.');
          return;
        }
        setError('');
        onSave({
          category,
          amount: value,
          expense_date: expenseDate,
          payment_method: paymentMethod,
          vendor_name: vendorName || undefined,
          reference: reference || undefined,
          notes: notes || undefined,
        }).catch((e: Error) => setError(e.message));
      }}
    >
      <Field label="What was it for">
        <Select
          value={category}
          onChange={setCategory}
          options={options.map((c) => ({ value: c.key, label: c.label }))}
        />
      </Field>
      {selected && selected.kind !== 'operating' && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: -4 }}>
          {selected.kind === 'cogs'
            ? 'Stock cost is already counted through item cost prices, so this will not reduce profit again.'
            : 'Money taken out of the business is not a business cost, so this will not reduce profit.'}
        </div>
      )}
      <Field label="Amount (GH₵)">
        <TextInput value={amount} onChange={setAmount} placeholder="150.00" type="number" autoFocus />
      </Field>
      <Field label="Date">
        <TextInput value={expenseDate} onChange={setExpenseDate} type="date" />
      </Field>
      <Field label="How it was paid">
        <Select
          value={paymentMethod}
          onChange={(v) => setPaymentMethod(v as ExpensePaymentMethod)}
          options={PAYMENT_METHODS}
        />
      </Field>
      <Field label="Paid to (optional)">
        <TextInput value={vendorName} onChange={setVendorName} placeholder="Landlord, ECG, Shell…" />
      </Field>
      <Field label="Receipt no. (optional)">
        <TextInput value={reference} onChange={setReference} placeholder="RCT-001" />
      </Field>
      <Field label="Note (optional)">
        <TextInput value={notes} onChange={setNotes} placeholder="Anything worth remembering" />
      </Field>
    </Modal>
  );
}
