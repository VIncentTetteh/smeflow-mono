'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useKycQueue, useReviewKyc } from '@/hooks/admin/useAdminQueues';

type KycItem = {
  id: string;
  scope?: 'business' | 'user';
  business_name: string;
  subject_name?: string;
  submitted_at: string;
  document_count: number | null;
  documents?: Record<string, string>;
  status: string;
  ghana_card_id: string | null;
  tin: string | null;
  business_id: string | null;
  user_id?: string;
};

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  let cls = 'sf-pill sf-pill-neutral';
  if (s === 'approved' || s === 'verified') cls = 'sf-pill sf-pill-success';
  else if (s === 'rejected') cls = 'sf-pill sf-pill-danger';
  else if (s === 'pending' || s === 'submitted') cls = 'sf-pill sf-pill-warn';
  return <span className={cls}>{status}</span>;
}

export default function AdminKycQueue() {
  const { data: queue, isLoading } = useKycQueue();
  const review = useReviewKyc();
  const [selected, setSelected] = useState<KycItem | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const items = queue ?? [];

  const handleApprove = () => {
    if (!selected) return;
    review.mutate(
      { businessId: selected.business_id, userId: selected.user_id, scope: selected.scope ?? 'business', approved: true, totp_code: totpCode.trim() || undefined },
      { onSuccess: () => { setSelected(null); setTotpCode(''); } }
    );
  };

  const handleReject = () => {
    if (!selected) return;
    review.mutate(
      { businessId: selected.business_id, userId: selected.user_id, scope: selected.scope ?? 'business', approved: false, reason: rejectionReason, totp_code: totpCode.trim() || undefined },
      { onSuccess: () => { setSelected(null); setRejectionReason(''); setTotpCode(''); } }
    );
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: 56, padding: '0 22px',
        borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Compliance
          </div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            KYC review queue
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!isLoading && items.length > 0 && (
          <span className="sf-pill sf-pill-warn">{items.length} pending</span>
        )}
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 110px 160px 80px 120px 100px',
            gap: 10, padding: '10px 18px',
            borderBottom: '1px solid var(--sf-line)',
            fontSize: 10, color: 'var(--ink-4)',
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <span>Business</span>
            <span>Scope</span>
            <span>Submitted</span>
            <span>Docs</span>
            <span>Status</span>
            <span />
          </div>

          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 110px 160px 80px 120px 100px',
                  gap: 10, padding: '14px 18px',
                  borderBottom: i < 4 ? '1px solid var(--sf-line)' : 'none',
                  alignItems: 'center',
                }}
              >
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4, width: j === 0 ? '70%' : '50%' }} />
                ))}
                <div />
              </div>
            ))
          ) : items.length === 0 ? (
            <div style={{ padding: '48px 18px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: '0 auto 10px' }}>
                <path d="M12 3 4 6v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>
              </svg>
              No pending KYC submissions
            </div>
          ) : (
            items.map((item, i) => (
              <div
                key={item.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 110px 160px 80px 120px 100px',
                  gap: 10, padding: '13px 18px',
                  borderBottom: i < items.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  alignItems: 'center', fontSize: 13,
                  transition: 'background 0.1s', cursor: 'default',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{item.subject_name ?? item.business_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{item.business_name}</div>
                  <div className="sf-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 1 }}>{item.scope === 'user' ? item.user_id : item.business_id}</div>
                </div>
                <span className={`sf-pill ${item.scope === 'user' ? 'sf-pill-brand' : 'sf-pill-neutral'}`} style={{ fontSize: 10.5 }}>
                  {item.scope === 'user' ? 'User KYC' : 'Business KYC'}
                </span>
                <span style={{ color: 'var(--ink-2)' }}>{new Date(item.submitted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                <span style={{ color: 'var(--ink-2)' }}>{item.document_count ?? 0} files</span>
                <StatusPill status={item.status} />
                <div style={{ textAlign: 'right' }}>
                  <button
                    onClick={() => { setRejectionReason(''); setTotpCode(''); setSelected(item); }}
                    style={{
                      all: 'unset', cursor: 'pointer',
                      padding: '5px 12px', borderRadius: 7,
                      border: '1px solid var(--sf-line-2)',
                      fontSize: 12, fontWeight: 600, color: 'var(--ink-2)',
                      background: 'var(--sf-surface)',
                      transition: 'border-color 0.1s, background 0.1s',
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--brand)'; (e.currentTarget as HTMLElement).style.color = 'var(--brand)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--sf-line-2)'; (e.currentTarget as HTMLElement).style.color = 'var(--ink-2)'; }}
                  >
                    Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={() => { setSelected(null); setTotpCode(''); }}>
        <DialogContent style={{ maxWidth: 480 }}>
          <DialogHeader>
            <DialogTitle>
              <span className="sf-display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                {selected?.subject_name ?? selected?.business_name}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`sf-pill ${selected?.scope === 'user' ? 'sf-pill-brand' : 'sf-pill-neutral'}`}>
                {selected?.scope === 'user' ? 'User KYC' : 'Business KYC'}
              </span>
              <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{selected?.business_name}</span>
            </div>
            {selected?.submitted_at && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Submitted {new Date(selected.submitted_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ padding: '10px 12px', background: 'var(--sf-sunken)', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Ghana Card</div>
                <div className="sf-mono" style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>{selected?.ghana_card_id ?? '—'}</div>
              </div>
              <div style={{ padding: '10px 12px', background: 'var(--sf-sunken)', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>GRA TIN</div>
                <div className="sf-mono" style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>{selected?.tin ?? '—'}</div>
              </div>
            </div>

            <div style={{ padding: '10px 12px', background: 'var(--sf-sunken)', borderRadius: 10 }}>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Documents</div>
              {Object.entries(selected?.documents ?? {}).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>No document links attached</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {Object.entries(selected?.documents ?? {}).map(([label, url]) => (
                    <a key={label} href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--brand)', fontWeight: 600, textDecoration: 'none', overflowWrap: 'anywhere' }}>
                      {label}
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Admin TOTP code</label>
              <Input
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit authenticator code"
                maxLength={6}
                inputMode="numeric"
                autoComplete="one-time-code"
                style={{ height: 38, borderRadius: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.16em' }}
              />
            </div>

            <Textarea
              placeholder="Rejection reason (required when rejecting)"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              rows={3}
              style={{ fontSize: 13, borderColor: 'var(--sf-line-2)', borderRadius: 10, resize: 'none' }}
            />

            <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
              <button
                onClick={handleReject}
                disabled={review.isPending || !rejectionReason.trim()}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, border: '1px solid var(--sf-line-2)',
                  background: 'var(--sf-surface)', color: review.isPending || !rejectionReason.trim() ? 'var(--ink-4)' : 'var(--danger)',
                  fontSize: 13, fontWeight: 600, cursor: review.isPending || !rejectionReason.trim() ? 'not-allowed' : 'pointer',
                  transition: 'background 0.1s',
                }}
              >
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={review.isPending}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, border: 'none',
                  background: review.isPending ? 'var(--brand-soft-2)' : 'var(--brand)',
                  color: review.isPending ? 'var(--ink-3)' : '#fff',
                  fontSize: 13, fontWeight: 600, cursor: review.isPending ? 'not-allowed' : 'pointer',
                  transition: 'background 0.1s',
                }}
              >
                {review.isPending ? 'Processing…' : 'Approve'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
