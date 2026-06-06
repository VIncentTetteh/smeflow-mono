'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAdminAgents, useCreateAgent, useUpdateAgent, useDeactivateAgent, useDeleteAgent } from '@/hooks/admin/useAdminPeople';

const agentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  phone: z.string().regex(/^\+233\d{9}$/, 'Format: +233XXXXXXXXX'),
  region: z.string().min(2, 'Region is required'),
  totp_code: z.string().regex(/^\d{6}$/, 'Must be 6 digits').or(z.literal('')).optional(),
});
type AgentForm = z.infer<typeof agentSchema>;

const editSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').or(z.literal('')),
  phone: z.string().regex(/^\+233\d{9}$/, 'Format: +233XXXXXXXXX').or(z.literal('')),
  region: z.string().min(2, 'Region is required').or(z.literal('')),
  district: z.string().or(z.literal('')),
});
type EditForm = z.infer<typeof editSchema>;

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(245,239,225,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

type Agent = {
  id: string;
  user_id: string;
  name?: string | null;
  phone?: string | null;
  region: string | null;
  district: string | null;
  is_active: boolean;
  onboarded_count: number;
  total_commission_earned: string;
  created_at: string;
};

function AgentRow({ agent, index, total }: { agent: Agent; index: number; total: number }) {
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const updateAgent = useUpdateAgent();
  const setAgentActive = useDeactivateAgent();
  const deleteAgent = useDeleteAgent();

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<EditForm>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: agent.name ?? '',
      phone: agent.phone ?? '',
      region: agent.region ?? '',
      district: agent.district ?? '',
    },
  });

  const onEdit = async (data: EditForm) => {
    await updateAgent.mutateAsync({
      id: agent.id,
      ...(data.name ? { name: data.name } : {}),
      ...(data.phone ? { phone: data.phone } : {}),
      ...(data.region ? { region: data.region } : {}),
      ...(data.district ? { district: data.district } : {}),
    });
    reset();
    setEditOpen(false);
  };

  return (
    <div style={{
      borderBottom: index < total - 1 ? '1px solid var(--sf-line)' : 'none',
      opacity: agent.is_active ? 1 : 0.5,
    }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.5fr 140px 120px 80px 120px 180px',
        gap: 10, padding: '13px 18px',
        alignItems: 'center', fontSize: 13,
        transition: 'background 0.1s',
      }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
              {agent.name ?? `Agent ${agent.user_id.slice(-6).toUpperCase()}`}
            </span>
            {!agent.is_active && <span className="sf-pill sf-pill-danger" style={{ fontSize: 9.5 }}>Inactive</span>}
          </div>
          <div className="sf-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>EM-{agent.id.slice(-4)}</div>
        </div>
        <span className="sf-mono" style={{ color: 'var(--ink-2)', fontSize: 12 }}>{agent.phone ?? '—'}</span>
        <span style={{ color: 'var(--ink-2)' }}>{agent.region ?? '—'}</span>
        <span className="sf-num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{agent.onboarded_count ?? 0}</span>
        <span className="sf-num" style={{ color: 'var(--brand)', fontWeight: 600 }}>GH₵ {Number(agent.total_commission_earned ?? 0).toFixed(2)}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
          <Sheet open={editOpen} onOpenChange={setEditOpen}>
            <SheetTrigger style={{
              padding: '4px 10px', borderRadius: 6,
              border: '1px solid var(--sf-line)', background: 'transparent',
              fontSize: 11, color: 'var(--ink-2)', cursor: 'pointer', fontWeight: 600,
            }}>
              Edit
            </SheetTrigger>
            <SheetContent style={{ background: '#1c1812', color: '#f5efe1', border: 'none' }}>
              <SheetHeader>
                <SheetTitle style={{ color: '#f5efe1', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>
                  Edit agent
                </SheetTitle>
              </SheetHeader>
              <form onSubmit={handleSubmit(onEdit)} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <FieldRow label="Full name">
                  <Input {...register('name')} placeholder="Kwame Asante"
                    style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42 }} />
                  {errors.name && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.name.message}</p>}
                </FieldRow>
                <FieldRow label="Phone (+233XXXXXXXXX)">
                  <Input {...register('phone')} placeholder="+233244123456"
                    style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42, fontFamily: 'var(--font-mono)' }} />
                  {errors.phone && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.phone.message}</p>}
                </FieldRow>
                <FieldRow label="Region">
                  <Input {...register('region')} placeholder="Greater Accra"
                    style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42 }} />
                  {errors.region && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.region.message}</p>}
                </FieldRow>
                <FieldRow label="District">
                  <Input {...register('district')} placeholder="Accra Metropolitan"
                    style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42 }} />
                  {errors.district && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.district.message}</p>}
                </FieldRow>
                <p style={{ fontSize: 11, color: 'rgba(245,239,225,0.35)', marginTop: -8 }}>Leave a field blank to keep its current value.</p>
                <button type="submit" disabled={isSubmitting || updateAgent.isPending} style={{
                  marginTop: 8, height: 44, borderRadius: 10, border: 'none',
                  background: isSubmitting || updateAgent.isPending ? 'rgba(245,239,225,0.1)' : 'var(--gold-2)',
                  color: isSubmitting || updateAgent.isPending ? 'rgba(245,239,225,0.4)' : '#1a1612',
                  fontSize: 13.5, fontWeight: 700, cursor: isSubmitting || updateAgent.isPending ? 'not-allowed' : 'pointer',
                }}>
                  {updateAgent.isPending ? 'Saving…' : 'Save changes'}
                </button>
              </form>
            </SheetContent>
          </Sheet>

          {agent.is_active && !confirmDeactivate && (
            <button
              onClick={() => setConfirmDeactivate(true)}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid var(--danger)', background: 'transparent',
                fontSize: 11, color: 'var(--danger)', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Deactivate
            </button>
          )}
          {agent.is_active && confirmDeactivate && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={async () => { await setAgentActive.mutateAsync({ id: agent.id, active: false }); setConfirmDeactivate(false); }}
                disabled={setAgentActive.isPending}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: 'none',
                  background: 'var(--danger)', color: '#fff',
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                  {setAgentActive.isPending ? '…' : 'Yes'}
              </button>
              <button
                onClick={() => setConfirmDeactivate(false)}
                style={{
                  padding: '4px 10px', borderRadius: 6,
                  border: '1px solid var(--sf-line)', background: 'transparent',
                  fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer', fontWeight: 600,
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {!agent.is_active && (
            <Link href={`/admin/commissions?agent=${agent.id}`}
              style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, textDecoration: 'none' }}>
              Commissions →
            </Link>
          )}
          {agent.is_active && !confirmDeactivate && (
            <Link href={`/admin/commissions?agent=${agent.id}`}
              style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 600, textDecoration: 'none' }}>
              Commissions →
            </Link>
          )}

          {!confirmDelete && !confirmDeactivate && (
            <button
              onClick={() => { setDeleteError(null); setConfirmDelete(true); }}
              style={{
                padding: '4px 10px', borderRadius: 6,
                border: '1px solid rgba(240,128,112,0.4)', background: 'transparent',
                fontSize: 11, color: '#f08070', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Delete
            </button>
          )}
          {confirmDelete && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={async () => {
                    setDeleteError(null);
                    try {
                      await deleteAgent.mutateAsync(agent.id);
                    } catch (err) {
                      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                      setDeleteError(msg ?? 'Delete failed.');
                      setConfirmDelete(false);
                    }
                  }}
                  disabled={deleteAgent.isPending}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: 'none',
                    background: '#f08070', color: '#fff',
                    fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  {deleteAgent.isPending ? '…' : 'Delete'}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  style={{
                    padding: '4px 10px', borderRadius: 6,
                    border: '1px solid var(--sf-line)', background: 'transparent',
                    fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Cancel
                </button>
              </div>
              {deleteError && (
                <p style={{ fontSize: 11, color: '#f08070', maxWidth: 220, textAlign: 'right', margin: 0 }}>{deleteError}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminAgents() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminAgents(page, search);
  const agents = data?.items ?? [];
  const createAgent = useCreateAgent();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<AgentForm>({
    resolver: zodResolver(agentSchema),
  });

  useEffect(() => {
    setPage(1);
  }, [search]);

  const onSubmit = async (data: AgentForm) => {
    setServerError(null);
    try {
      await createAgent.mutateAsync({
        name: data.name,
        phone: data.phone,
        region: data.region,
        totp_code: data.totp_code || undefined,
      });
      reset();
      setOpen(false);
    } catch (err) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setServerError(msg ?? 'Failed to create agent. Please try again.');
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>People</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Field agents</div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 12px', border: '1px solid var(--sf-line-2)',
          borderRadius: 999, background: 'var(--sf-surface)', width: 260,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or phone..."
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--ink)' }}
          />
        </div>
        <Sheet open={open} onOpenChange={(v) => { setOpen(v); if (!v) { reset(); setServerError(null); } }}>
          <SheetTrigger style={{
              padding: '8px 16px', borderRadius: 9, border: 'none',
              background: 'var(--gold-2)', color: '#1a1612',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Add agent
          </SheetTrigger>
          <SheetContent style={{ background: '#1c1812', color: '#f5efe1', border: 'none' }}>
            <SheetHeader>
              <SheetTitle style={{ color: '#f5efe1', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>
                Create agent account
              </SheetTitle>
            </SheetHeader>
            <form onSubmit={handleSubmit(onSubmit)} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <FieldRow label="Full name">
                <Input {...register('name')} style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42 }} />
                {errors.name && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.name.message}</p>}
              </FieldRow>
              <FieldRow label="Phone (+233XXXXXXXXX)">
                <Input {...register('phone')} placeholder="+233244123456"
                  style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42, fontFamily: 'var(--font-mono)' }} />
                {errors.phone && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.phone.message}</p>}
              </FieldRow>
              <FieldRow label="Region">
                <Input {...register('region')} placeholder="Greater Accra"
                  style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42 }} />
                {errors.region && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.region.message}</p>}
              </FieldRow>
              <FieldRow label="Admin TOTP code (if enabled)">
                <Input {...register('totp_code')} placeholder="6-digit authenticator code"
                  maxLength={6} inputMode="numeric" autoComplete="one-time-code"
                  style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42, fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }} />
                {errors.totp_code && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.totp_code.message}</p>}
                <p style={{ fontSize: 11, color: 'rgba(245,239,225,0.35)', marginTop: 4 }}>Required only if your account has two-factor authentication enabled.</p>
              </FieldRow>
              {serverError && (
                <p style={{ fontSize: 12, color: '#f08070', background: 'rgba(240,128,112,0.1)', borderRadius: 7, padding: '8px 12px' }}>
                  {serverError}
                </p>
              )}
              <button type="submit" disabled={isSubmitting || createAgent.isPending} style={{
                marginTop: 8, height: 44, borderRadius: 10, border: 'none',
                background: isSubmitting || createAgent.isPending ? 'rgba(245,239,225,0.1)' : 'var(--gold-2)',
                color: isSubmitting || createAgent.isPending ? 'rgba(245,239,225,0.4)' : '#1a1612',
                fontSize: 13.5, fontWeight: 700, cursor: isSubmitting || createAgent.isPending ? 'not-allowed' : 'pointer',
              }}>
                {createAgent.isPending ? 'Creating…' : 'Create agent'}
              </button>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.5fr 140px 120px 80px 120px 180px',
            gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Agent</div><div>Phone</div><div>Region</div><div>Onboarded</div><div>Total earned</div><div />
          </div>

          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1.5fr 140px 120px 80px 120px 180px',
                gap: 10, padding: '14px 18px', borderBottom: i < 3 ? '1px solid var(--sf-line)' : 'none',
              }}>
                {Array.from({ length: 5 }).map((__, j) => (
                  <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4 }} />
                ))}
                <div />
              </div>
            ))
          ) : agents.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              No agents found
            </div>
          ) : (
            agents.map((agent, i, a) => (
              <AgentRow key={agent.id} agent={agent} index={i} total={a.length} />
            ))
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pagerStyle(page <= 1)}>Previous</button>
          <button onClick={() => setPage((p) => p + 1)} disabled={agents.length < 20 || (data?.total ?? 0) <= page * 20} style={pagerStyle(agents.length < 20 || (data?.total ?? 0) <= page * 20)}>Next</button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'center', marginLeft: 8 }}>
            Page {page} · {data?.total ?? 0} agents
          </span>
        </div>
      </div>
    </div>
  );
}

function pagerStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 16px',
    borderRadius: 9,
    border: '1px solid var(--sf-line-2)',
    background: 'var(--sf-surface)',
    color: disabled ? 'var(--ink-4)' : 'var(--ink-2)',
    fontSize: 12.5,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
