'use client';
import { useState } from 'react';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TotpDialog } from '@/components/admin/TotpDialog';
import { useAdminBusinesses, useDisableBusiness, useUpdateBusinessSubscription } from '@/hooks/admin/useAdminData';

const PLANS = ['free', 'starter', 'pro'] as const;
type Plan = typeof PLANS[number];

function planColor(plan: Plan) {
  if (plan === 'pro') return { bg: 'var(--gold-soft)', color: 'var(--gold-2)' };
  if (plan === 'starter') return { bg: 'var(--brand-soft)', color: 'var(--brand)' };
  return { bg: 'var(--sf-sunken)', color: 'var(--ink-3)' };
}

export default function AdminBusinesses() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totpAction, setTotpAction] = useState<
    | { type: 'subscription'; businessId: string; tier: string; title: string; description: string }
    | { type: 'active'; businessId: string; active: boolean; title: string; description: string }
    | null
  >(null);
  const { data, isLoading } = useAdminBusinesses(page, search);
  const updateSub = useUpdateBusinessSubscription();
  const setBusinessActive = useDisableBusiness();
  const businesses = data?.items ?? [];

  const handleTotpConfirm = (code?: string) => {
    if (!totpAction) return;
    if (totpAction.type === 'subscription') {
      updateSub.mutate(
        { businessId: totpAction.businessId, tier: totpAction.tier, totp_code: code },
        { onSuccess: () => setTotpAction(null) }
      );
      return;
    }
    setBusinessActive.mutate(
      { id: totpAction.businessId, active: totpAction.active, totp_code: code },
      { onSuccess: () => setTotpAction(null) }
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Merchants</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Search */}
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
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name or phone…"
            style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 12.5, color: 'var(--ink)' }}
          />
        </div>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1.8fr 100px 120px 150px 60px',
            gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Business</div><div>Type</div><div>Plan</div><div>Status</div><div />
          </div>

          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1.8fr 100px 120px 150px 60px',
                gap: 10, padding: '14px 18px', borderBottom: i < 5 ? '1px solid var(--sf-line)' : 'none',
                alignItems: 'center',
              }}>
                {Array.from({ length: 5 }).map((__, j) => (
                  <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4, width: j === 0 ? '75%' : '55%' }} />
                ))}
                <div />
              </div>
            ))
          ) : businesses.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              No merchants found
            </div>
          ) : (
            businesses.map((biz, i, a) => {
              const plan = (biz.subscription ?? 'free') as Plan;
              const pc = planColor(plan);
              return (
                <div key={biz.id} style={{
                  display: 'grid', gridTemplateColumns: '1.8fr 100px 120px 150px 60px',
                  gap: 10, padding: '13px 18px',
                  borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  alignItems: 'center', fontSize: 13,
                  transition: 'background 0.1s', cursor: 'default',
                }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{biz.name}</div>
                    <div className="sf-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>
                      {new Date(biz.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </div>
                  <span style={{ color: 'var(--ink-2)', fontSize: 12, textTransform: 'capitalize' }}>{biz.type}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ padding: '2px 8px', borderRadius: 9999, fontSize: 11, fontWeight: 600, background: pc.bg, color: pc.color }}>
                      {plan}
                    </span>
                    <Select
                      defaultValue={plan}
                      onValueChange={(tier) => {
                        if (!tier || tier === plan) return;
                        setTotpAction({
                          type: 'subscription',
                          businessId: biz.id,
                          tier,
                          title: 'Change subscription tier',
                          description: `${biz.name} will move from ${plan} to ${tier}.`,
                        });
                      }}
                    >
                      <SelectTrigger style={{ height: 24, width: 24, padding: 0, border: '1px solid var(--sf-line-2)', borderRadius: 6, justifyContent: 'center' }}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PLANS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`sf-pill ${biz.is_active ? 'sf-pill-success' : 'sf-pill-danger'}`} style={{ fontSize: 10.5 }}>
                      {biz.is_active ? 'Active' : 'Suspended'}
                    </span>
                    <button
                      onClick={() => setTotpAction({
                        type: 'active',
                        businessId: biz.id,
                        active: !biz.is_active,
                        title: biz.is_active ? 'Suspend merchant' : 'Unsuspend merchant',
                        description: biz.is_active
                          ? `${biz.name} members will lose access until the business is unsuspended.`
                          : `${biz.name} members will regain access.`,
                      })}
                      disabled={setBusinessActive.isPending}
                      style={{
                        all: 'unset', cursor: setBusinessActive.isPending ? 'not-allowed' : 'pointer',
                        fontSize: 11, fontWeight: 600,
                        color: biz.is_active ? 'var(--danger)' : 'var(--brand)',
                      }}
                    >
                      {biz.is_active ? 'Suspend' : 'Unsuspend'}
                    </button>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <a href={`/admin/businesses/${biz.id}`} style={{
                      fontSize: 12, color: 'var(--ink-3)', fontWeight: 600, textDecoration: 'none',
                      display: 'inline-flex', alignItems: 'center',
                    }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 18l6-6-6-6"/>
                      </svg>
                    </a>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Pagination */}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {[
            { label: '← Previous', disabled: page <= 1, onClick: () => setPage((p) => p - 1) },
            { label: 'Next →', disabled: businesses.length < 20, onClick: () => setPage((p) => p + 1) },
          ].map(({ label, disabled, onClick }) => (
            <button key={label} onClick={onClick} disabled={disabled} style={{
              padding: '7px 16px', borderRadius: 9,
              border: '1px solid var(--sf-line-2)',
              background: 'var(--sf-surface)',
              color: disabled ? 'var(--ink-4)' : 'var(--ink-2)',
              fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
            }}>
              {label}
            </button>
          ))}
          <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'center', marginLeft: 8 }}>
            Page {page}
          </span>
        </div>
      </div>
      <TotpDialog
        open={!!totpAction}
        title={totpAction?.title ?? ''}
        description={totpAction?.description}
        confirmLabel="Apply change"
        isPending={updateSub.isPending || setBusinessActive.isPending}
        onOpenChange={(open) => { if (!open) setTotpAction(null); }}
        onConfirm={handleTotpConfirm}
      />
    </div>
  );
}
