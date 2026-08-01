'use client';
import { useState } from 'react';
import {
  useInvoices,
  useGenerateInvoice,
  useVoidInvoice,
  useSendInvoice,
  type InvoiceLineInput,
} from '@/hooks/store/useStoreInvoicing';
import { PageShell, Card, Button, Badge, EmptyState, Spinner, Table, ghs } from '@/components/store/kit';
import { Modal, Field, TextInput } from '@/components/store/Modal';
import { toast } from 'sonner';

export default function InvoicingPage() {
  const { data, isLoading } = useInvoices();
  const generate = useGenerateInvoice();
  const voidInv = useVoidInvoice();
  const send = useSendInvoice();
  const [show, setShow] = useState(false);
  const invoices = data?.invoices ?? [];

  return (
    <PageShell
      title="Invoicing"
      subtitle={data ? `${data.total} invoices` : undefined}
      actions={<Button onClick={() => setShow(true)}>+ New invoice</Button>}
    >
      {isLoading ? (
        <Spinner />
      ) : invoices.length === 0 ? (
        <EmptyState title="No invoices yet" hint="Generate a VAT invoice for a customer." />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Invoice', 'Customer', 'Total', 'Balance', 'Status', 'Issued', '']}
            rows={invoices.map((inv) => [
              <span key="n" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {inv.invoice_number}
              </span>,
              inv.customer_name ?? '—',
              ghs(inv.total),
              Number(inv.balance_due) > 0 ? (
                <span key="b" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                  {ghs(inv.balance_due)}
                </span>
              ) : (
                ghs(0)
              ),
              <Badge
                key="s"
                tone={
                  inv.effective_status === 'paid'
                    ? 'success'
                    : inv.effective_status === 'cancelled'
                      ? 'danger'
                      : inv.effective_status === 'overdue'
                        ? 'warn'
                        : 'default'
                }
              >
                {inv.effective_status}
              </Badge>,
              new Date(inv.issued_at).toLocaleDateString(),
              <div key="a" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                {inv.pdf_url && (
                  <a href={inv.pdf_url} target="_blank" rel="noreferrer" style={linkBtn}>
                    PDF
                  </a>
                )}
                <Button
                  variant="ghost"
                  onClick={() => send.mutate(inv.id, { onSuccess: () => toast.success('Invoice sent') })}
                >
                  Send
                </Button>
                {inv.status !== 'cancelled' && (
                  <Button
                    variant="danger"
                    onClick={() => {
                      if (confirm('Void this invoice?')) voidInv.mutate(inv.id);
                    }}
                  >
                    Void
                  </Button>
                )}
              </div>,
            ])}
          />
        </Card>
      )}

      {show && (
        <GenerateModal
          saving={generate.isPending}
          onClose={() => setShow(false)}
          onSave={async (body) => {
            await generate.mutateAsync(body);
            setShow(false);
            toast.success('Invoice created');
          }}
        />
      )}
    </PageShell>
  );
}

function GenerateModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: {
    customer_name?: string;
    customer_phone?: string;
    line_items: InvoiceLineInput[];
    due_date?: string;
  }) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [lines, setLines] = useState<{ description: string; qty: string; unit_price: string }[]>([
    { description: '', qty: '1', unit_price: '' },
  ]);
  const [error, setError] = useState('');

  const updateLine = (i: number, key: 'description' | 'qty' | 'unit_price', value: string) => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [key]: value } : l)));
  };

  const submit = () => {
    const items = lines
      .filter((l) => l.description.trim() && Number(l.qty) > 0 && Number(l.unit_price) > 0)
      .map((l) => ({ description: l.description.trim(), qty: Number(l.qty), unit_price: Number(l.unit_price) }));
    if (items.length === 0) {
      setError('Add at least one line item with a description, quantity, and price.');
      return;
    }
    onSave({
      customer_name: name || undefined,
      customer_phone: phone || undefined,
      due_date: dueDate || undefined,
      line_items: items,
    });
  };

  const total = lines.reduce((sum, l) => sum + Number(l.qty || 0) * Number(l.unit_price || 0), 0);

  return (
    <Modal title="New invoice" onClose={onClose} onSubmit={submit} saving={saving} error={error} submitLabel="Create invoice">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Customer name">
          <TextInput value={name} onChange={setName} autoFocus />
        </Field>
        <Field label="Customer phone">
          <TextInput value={phone} onChange={setPhone} />
        </Field>
      </div>
      <Field label="Due date (optional)">
        <TextInput value={dueDate} onChange={setDueDate} type="date" />
      </Field>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 6 }}>
        Line items
      </div>
      {lines.map((l, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr auto', gap: 8, alignItems: 'center' }}>
          <TextInput value={l.description} onChange={(v) => updateLine(i, 'description', v)} placeholder="Description" />
          <TextInput value={l.qty} onChange={(v) => updateLine(i, 'qty', v)} type="number" placeholder="Qty" />
          <TextInput value={l.unit_price} onChange={(v) => updateLine(i, 'unit_price', v)} type="number" placeholder="Price" />
          <button
            onClick={() => setLines((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev))}
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 18, padding: '0 6px' }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        onClick={() => setLines((prev) => [...prev, { description: '', qty: '1', unit_price: '' }])}
        style={{ all: 'unset', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: 'var(--brand)' }}
      >
        + Add line
      </button>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 6, fontSize: 13 }}>
        <span style={{ color: 'var(--ink-3)' }}>Subtotal (excl. VAT):</span>
        <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{ghs(total)}</span>
      </div>
    </Modal>
  );
}

const linkBtn: React.CSSProperties = {
  height: 38,
  padding: '0 14px',
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--brand)',
  border: '1px solid var(--sf-line-2)',
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
};
