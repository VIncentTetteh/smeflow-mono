'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAdminBusinessDetail, useUpdateBusinessSubscription, useDisableBusiness } from '@/hooks/admin/useAdminData';

function KycStatusBadge({ status }: { status: string | null }) {
  if (!status) return <span className="sf-pill sf-pill-neutral">Unknown</span>;
  if (status === 'verified') return <span className="sf-pill sf-pill-success">Verified</span>;
  if (status === 'submitted' || status === 'pending') return <span className="sf-pill sf-pill-warn">Pending review</span>;
  if (status === 'rejected') return <span className="sf-pill sf-pill-danger">Rejected</span>;
  return <span className="sf-pill sf-pill-neutral">{status}</span>;
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--sf-line)' }}>
        <div className="sf-display" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      </div>
      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 500 }}>{value ?? '—'}</span>
    </div>
  );
}

export default function BusinessDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: biz, isLoading } = useAdminBusinessDetail(id);
  const updateSub = useUpdateBusinessSubscription();
  const disableBiz = useDisableBusiness();
  const [confirmDisable, setConfirmDisable] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [pendingTier, setPendingTier] = useState('');

  const handleDisable = async () => {
    await disableBiz.mutateAsync({ id, active: false, totp_code: totpCode.trim() || undefined });
    setConfirmDisable(false);
    setTotpCode('');
    router.push('/admin/businesses');
  };

  const handlePlanChange = async () => {
    if (!pendingTier) return;
    await updateSub.mutateAsync({ businessId: biz!.id, tier: pendingTier, totp_code: totpCode.trim() || undefined });
    setPendingTier('');
    setTotpCode('');
  };

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading…</span>
      </div>
    );
  }

  if (!biz) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>Business not found</div>
          <button onClick={() => router.push('/admin/businesses')} style={{
            padding: '8px 16px', borderRadius: 9, border: '1px solid var(--sf-line)',
            background: 'transparent', color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
          }}>
            ← Back to merchants
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <button
          onClick={() => router.push('/admin/businesses')}
          style={{
            all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, color: 'var(--ink-3)', fontWeight: 600,
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5M12 19l-7-7 7-7"/>
          </svg>
          Merchants
        </button>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2">
          <path d="M9 18l6-6-6-6"/>
        </svg>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Merchant detail</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{biz.name}</div>
        </div>
        <div style={{ flex: 1 }} />
        {!biz.is_active && <span className="sf-pill sf-pill-danger">Disabled</span>}
        {biz.is_active && confirmDisable && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Disable this business?</span>
            <input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="TOTP"
              maxLength={6}
              inputMode="numeric"
              style={{
                width: 78, height: 30, borderRadius: 8,
                border: '1px solid var(--sf-line)', background: 'var(--sf-sunken)',
                color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-mono)',
                padding: '0 8px',
              }}
            />
            <button onClick={handleDisable} disabled={disableBiz.isPending} style={{
              padding: '6px 14px', borderRadius: 8, border: 'none',
              background: 'var(--danger)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer',
            }}>
              {disableBiz.isPending ? 'Disabling…' : 'Yes, disable'}
            </button>
            <button onClick={() => setConfirmDisable(false)} style={{
              padding: '6px 14px', borderRadius: 8,
              border: '1px solid var(--sf-line)', background: 'transparent',
              color: 'var(--ink-2)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
            }}>
              Cancel
            </button>
          </div>
        )}
        {biz.is_active && !confirmDisable && (
          <button onClick={() => setConfirmDisable(true)} style={{
            padding: '8px 16px', borderRadius: 9,
            border: '1px solid var(--danger)', background: 'transparent',
            color: 'var(--danger)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
          }}>
            Disable business
          </button>
        )}
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14, maxWidth: 960 }}>
          {/* Left column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <DetailCard title="Business info">
              <Field label="Business name" value={biz.name} />
              <Field label="Business type" value={biz.type} />
              <Field label="Owner" value={biz.owner_name} />
              <Field label="Phone" value={biz.phone} />
              <Field label="Region" value={biz.region} />
              <Field label="Registered" value={new Date(biz.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} />
              <Field label="TIN" value={biz.tin ?? '—'} />
              <Field label="Status" value={biz.is_active ? 'Active' : 'Suspended'} />
            </DetailCard>

            <DetailCard title="Members">
              {(biz.members ?? []).length === 0 ? (
                <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>No members returned by the API</span>
              ) : (
                (biz.members ?? []).map((member) => (
                  <div key={member.user_id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 80px', gap: 10, alignItems: 'center' }}>
                    <span className="sf-mono" style={{ fontSize: 11, color: 'var(--ink-2)' }}>{member.user_id}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink)', textTransform: 'capitalize' }}>{member.role}</span>
                    <span className={`sf-pill ${member.is_active ? 'sf-pill-success' : 'sf-pill-neutral'}`} style={{ fontSize: 10 }}>{member.is_active ? 'Active' : 'Inactive'}</span>
                  </div>
                ))
              )}
            </DetailCard>
          </div>

          {/* Right column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <DetailCard title="KYC status">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <KycStatusBadge status={biz.kyc_status} />
                {(biz.kyc_status === 'submitted' || biz.kyc_status === 'pending') && (
                  <button
                    onClick={() => router.push(`/admin/kyc?business_id=${biz.id}`)}
                    style={{
                      padding: '4px 12px', borderRadius: 7,
                      border: '1px solid var(--sf-line)', background: 'transparent',
                      fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Review →
                  </button>
                )}
              </div>
            </DetailCard>

            <DetailCard title="Subscription">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="Current plan" value={
                  <span className={`sf-pill ${biz.subscription === 'pro' ? 'sf-pill-brand' : biz.subscription === 'starter' ? 'sf-pill-gold' : 'sf-pill-neutral'}`}>
                    {biz.subscription ?? 'Free'}
                  </span>
                } />
                <div>
                  <label style={{ display: 'block', fontSize: 10.5, fontWeight: 700, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Change plan
                  </label>
                  <Select
                    defaultValue={String(biz.subscription ?? 'free')}
                    onValueChange={(tier) => setPendingTier(tier ?? '')}
                    disabled={updateSub.isPending}
                  >
                    <SelectTrigger style={{ height: 38, borderRadius: 9, fontSize: 13 }}>
                      <SelectValue placeholder="Select plan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="free">Free</SelectItem>
                      <SelectItem value="starter">Starter</SelectItem>
                      <SelectItem value="pro">Pro</SelectItem>
                    </SelectContent>
                  </Select>
                  {pendingTier && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 }}>
                      <input
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value)}
                        placeholder="TOTP"
                        maxLength={6}
                        inputMode="numeric"
                        style={{
                          width: 92, height: 32, borderRadius: 8,
                          border: '1px solid var(--sf-line)', background: 'var(--sf-sunken)',
                          color: 'var(--ink)', fontSize: 12, fontFamily: 'var(--font-mono)',
                          padding: '0 8px',
                        }}
                      />
                      <button onClick={handlePlanChange} disabled={updateSub.isPending} style={{
                        padding: '7px 12px', borderRadius: 8,
                        border: 'none', background: 'var(--brand)', color: '#fff',
                        fontSize: 12, fontWeight: 700, cursor: updateSub.isPending ? 'not-allowed' : 'pointer',
                      }}>
                        {updateSub.isPending ? 'Updating…' : `Apply ${pendingTier}`}
                      </button>
                      <button onClick={() => { setPendingTier(''); setTotpCode(''); }} style={{
                        padding: '7px 12px', borderRadius: 8,
                        border: '1px solid var(--sf-line)', background: 'transparent',
                        color: 'var(--ink-3)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                      }}>Cancel</button>
                    </div>
                  )}
                  {updateSub.isPending && !pendingTier && <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Updating…</p>}
                </div>
              </div>
            </DetailCard>

            <DetailCard title="Billing and sales">
              <Field label="Billing status" value={biz.billing?.status ?? '—'} />
              <Field label="Billing plan" value={biz.billing?.plan ?? biz.subscription ?? 'free'} />
              <Field label="Period end" value={biz.billing?.current_period_end ? new Date(biz.billing.current_period_end).toLocaleDateString('en-GB') : '—'} />
              <Field label="Sales count" value={biz.sales?.count ?? 0} />
              <Field label="TPV" value={`GH₵ ${Number(biz.sales?.tpv_ghs ?? 0).toLocaleString()}`} />
            </DetailCard>
          </div>
        </div>
      </div>
    </div>
  );
}
