'use client';
import { useState } from 'react';
import {
  useEmployees,
  useCreateEmployee,
  usePayrollRuns,
  useCreatePayrollRun,
  usePayslips,
  useDisburseRun,
  type PayrollRun,
} from '@/hooks/store/useStorePayroll';
import { PageShell, Card, Button, Badge, StatCard, EmptyState, Spinner, Table, ghs } from '@/components/store/kit';
import { Modal, Field, TextInput, Select } from '@/components/store/Modal';
import { toast } from 'sonner';

type Tab = 'employees' | 'runs';

export default function PayrollPage() {
  const [tab, setTab] = useState<Tab>('employees');
  return (
    <PageShell title="Payroll" subtitle="Staff, salary runs, and payslips">
      <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
        {(
          [
            ['employees', 'Employees'],
            ['runs', 'Payroll runs'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '7px 14px',
              borderRadius: 9,
              fontSize: 13,
              fontWeight: 600,
              color: tab === key ? 'var(--brand)' : 'var(--ink-3)',
              background: tab === key ? 'var(--brand-soft)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'employees' ? <EmployeesTab /> : <RunsTab />}
    </PageShell>
  );
}

function EmployeesTab() {
  const { data, isLoading } = useEmployees();
  const create = useCreateEmployee();
  const [show, setShow] = useState(false);
  const employees = data ?? [];

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Button onClick={() => setShow(true)}>+ Add employee</Button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : employees.length === 0 ? (
        <EmptyState title="No employees yet" hint="Add staff to run payroll." />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Employee', 'Role', 'Pay type', 'Base pay', 'Status']}
            rows={employees.map((e) => [
              <div key="n">
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{e.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{e.phone ?? '—'}</div>
              </div>,
              e.role ?? '—',
              <Badge key="pt">{e.pay_type}</Badge>,
              ghs(e.base_pay),
              <Badge key="s" tone={e.is_active ? 'success' : 'danger'}>
                {e.is_active ? 'active' : 'inactive'}
              </Badge>,
            ])}
          />
        </Card>
      )}
      {show && (
        <EmployeeModal
          saving={create.isPending}
          onClose={() => setShow(false)}
          onSave={async (body) => {
            await create.mutateAsync(body);
            setShow(false);
            toast.success('Employee added');
          }}
        />
      )}
    </>
  );
}

function EmployeeModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: { name: string; base_pay: number; pay_type: string; phone?: string; role?: string; momo_phone?: string }) => void;
}) {
  const [name, setName] = useState('');
  const [basePay, setBasePay] = useState('');
  const [payType, setPayType] = useState('monthly');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('');
  const [momo, setMomo] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title="Add employee"
      onClose={onClose}
      onSubmit={() => {
        if (!name.trim() || !basePay) {
          setError('Name and base pay are required.');
          return;
        }
        onSave({
          name: name.trim(),
          base_pay: Number(basePay),
          pay_type: payType,
          phone: phone || undefined,
          role: role || undefined,
          momo_phone: momo || undefined,
        });
      }}
      saving={saving}
      error={error}
      submitLabel="Add employee"
    >
      <Field label="Name">
        <TextInput value={name} onChange={setName} autoFocus />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Base pay (GHS)">
          <TextInput value={basePay} onChange={setBasePay} type="number" />
        </Field>
        <Field label="Pay type">
          <Select
            value={payType}
            onChange={setPayType}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'daily', label: 'Daily' },
            ]}
          />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Role">
          <TextInput value={role} onChange={setRole} placeholder="e.g. Cashier" />
        </Field>
        <Field label="Phone">
          <TextInput value={phone} onChange={setPhone} />
        </Field>
      </div>
      <Field label="MoMo phone (for disbursement)">
        <TextInput value={momo} onChange={setMomo} />
      </Field>
    </Modal>
  );
}

function RunsTab() {
  const { data, isLoading } = usePayrollRuns();
  const create = useCreatePayrollRun();
  const disburse = useDisburseRun();
  const [show, setShow] = useState(false);
  const [viewRun, setViewRun] = useState<PayrollRun | null>(null);
  const runs = data ?? [];

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <Button onClick={() => setShow(true)}>+ New payroll run</Button>
      </div>
      {isLoading ? (
        <Spinner />
      ) : runs.length === 0 ? (
        <EmptyState title="No payroll runs yet" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Period', 'Status', 'Gross', 'Net', '']}
            rows={runs.map((r) => [
              <span key="p" style={{ color: 'var(--ink)' }}>
                {r.period_start} → {r.period_end}
              </span>,
              <Badge key="s" tone={r.status === 'disbursed' || r.status === 'completed' ? 'success' : 'default'}>
                {r.status}
              </Badge>,
              ghs(r.total_gross),
              <span key="n" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {ghs(r.total_net)}
              </span>,
              <div key="a" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => setViewRun(r)}>
                  Payslips
                </Button>
                {r.status !== 'disbursed' && (
                  <Button
                    onClick={() => {
                      if (confirm('Disburse salaries for this run via MoMo?')) {
                        disburse.mutate(r.id, { onSuccess: () => toast.success('Disbursement started') });
                      }
                    }}
                  >
                    Disburse
                  </Button>
                )}
              </div>,
            ])}
          />
        </Card>
      )}

      {show && (
        <RunModal
          saving={create.isPending}
          onClose={() => setShow(false)}
          onSave={async (body) => {
            await create.mutateAsync(body);
            setShow(false);
            toast.success('Payroll run created');
          }}
        />
      )}
      {viewRun && <PayslipsModal run={viewRun} onClose={() => setViewRun(null)} />}
    </>
  );
}

function RunModal({
  saving,
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: { period_start: string; period_end: string }) => void;
}) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [error, setError] = useState('');
  return (
    <Modal
      title="New payroll run"
      onClose={onClose}
      onSubmit={() => {
        if (!start || !end) {
          setError('Both dates are required.');
          return;
        }
        onSave({ period_start: start, period_end: end });
      }}
      saving={saving}
      error={error}
      submitLabel="Create run"
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Period start">
          <TextInput value={start} onChange={setStart} type="date" />
        </Field>
        <Field label="Period end">
          <TextInput value={end} onChange={setEnd} type="date" />
        </Field>
      </div>
    </Modal>
  );
}

function PayslipsModal({ run, onClose }: { run: PayrollRun; onClose: () => void }) {
  const { data, isLoading } = usePayslips(run.id);
  const slips = data ?? [];
  return (
    <Modal title={`Payslips · ${run.period_start} → ${run.period_end}`} onClose={onClose} onSubmit={onClose} submitLabel="Done">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 }}>
        <StatCard label="Gross" value={ghs(run.total_gross)} />
        <StatCard label="Deductions" value={ghs(run.total_deductions)} />
        <StatCard label="Net" value={ghs(run.total_net)} tone="brand" />
      </div>
      {isLoading ? (
        <Spinner />
      ) : slips.length === 0 ? (
        <EmptyState title="No payslips" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {slips.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--sf-bg)',
              }}
            >
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                Gross {ghs(s.gross_pay)} · SSNIT {ghs(s.ssnit_employee)} · PAYE {ghs(s.income_tax)}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{ghs(s.net_pay)}</span>
                {s.pdf_url && (
                  <a href={s.pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--brand)' }}>
                    PDF
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
