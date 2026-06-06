'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { getApiErrorMessage, useAdminLoans, useAdminLoanAction } from '@/hooks/admin/useAdminData';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending_partner: { bg: '#fff5cc', color: '#b6831e' },
  pending:         { bg: '#fff5cc', color: '#b6831e' },
  approved:        { bg: 'var(--brand-soft)', color: 'var(--brand)' },
  active:          { bg: 'var(--brand-soft)', color: 'var(--brand)' },
  disbursing:      { bg: 'var(--brand-soft)', color: 'var(--brand)' },
  repaid:          { bg: '#eafaf1', color: '#1a7a4a' },
  rejected:        { bg: '#fff0f0', color: 'var(--danger)' },
  defaulted:       { bg: '#fff0f0', color: 'var(--danger)' },
};

const STATUS_FILTERS = ['all', 'pending_partner', 'approved', 'active', 'repaid', 'rejected'];

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function relTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-GH', { day: 'numeric', month: 'short', year: '2-digit' });
}

type Loan = {
  id: string;
  business_id: string;
  amount_requested: number;
  amount_approved: number | null;
  lender_id: string | null;
  status: string;
  created_at: string;
};

function LoanActions({ loan }: { loan: Loan }) {
  const loanAction = useAdminLoanAction();
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [showFlag, setShowFlag] = useState(false);
  const [reason, setReason] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [error, setError] = useState('');

  const isPending = loan.status === 'pending' || loan.status === 'pending_partner';
  const isActive = loan.status === 'active' || loan.status === 'approved' || loan.status === 'disbursing';

  const handleApprove = async () => {
    setError('');
    try {
      await loanAction.mutateAsync({ loanId: loan.id, action: 'approve', totp_code: totpCode.trim() || undefined });
      setConfirmApprove(false);
      setTotpCode('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Loan approval failed.'));
    }
  };

  const handleReject = async () => {
    if (!reason.trim()) return;
    setError('');
    try {
      await loanAction.mutateAsync({ loanId: loan.id, action: 'reject', reason: reason.trim(), totp_code: totpCode.trim() || undefined });
      setShowReject(false);
      setReason('');
      setTotpCode('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Loan rejection failed.'));
    }
  };

  const handleFlag = async () => {
    if (!reason.trim()) return;
    setError('');
    try {
      await loanAction.mutateAsync({ loanId: loan.id, action: 'flag', reason: reason.trim(), totp_code: totpCode.trim() || undefined });
      setShowFlag(false);
      setReason('');
      setTotpCode('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Loan flag failed.'));
    }
  };

  if (!isPending && !isActive) return null;

  return (
    <td style={{ padding: '10px 10px' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        {isPending && !confirmApprove && !showReject && (
          <>
            <button
              onClick={() => setConfirmApprove(true)}
              style={{
                padding: '3px 10px', borderRadius: 6, border: 'none',
                background: 'var(--brand)', color: '#fff',
                fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              Approve
            </button>
            <button
              onClick={() => { setShowReject(true); setReason(''); }}
              style={{
                padding: '3px 10px', borderRadius: 6,
                border: '1px solid var(--danger)', background: 'transparent',
                color: 'var(--danger)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reject
            </button>
          </>
        )}
        {isPending && confirmApprove && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Approve?</span>
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="TOTP"
              maxLength={6}
              inputMode="numeric"
              style={{ width: 76, height: 24, borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <button onClick={handleApprove} disabled={loanAction.isPending} style={{
              padding: '3px 9px', borderRadius: 6, border: 'none',
              background: 'var(--brand)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
            }}>
              {loanAction.isPending ? '…' : 'Yes'}
            </button>
            <button onClick={() => setConfirmApprove(false)} style={{
              padding: '3px 9px', borderRadius: 6,
              border: '1px solid var(--sf-line)', background: 'transparent',
              color: 'var(--ink-3)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>
              No
            </button>
          </div>
        )}
        {error && <div style={{ color: 'var(--danger)', fontSize: 11, width: '100%', marginTop: 4 }}>{error}</div>}
        {isActive && !showFlag && (
          <button
            onClick={() => { setShowFlag(true); setReason(''); }}
            style={{
              padding: '3px 10px', borderRadius: 6,
              border: '1px solid var(--gold-2)', background: 'transparent',
              color: 'var(--gold-2)', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Flag
          </button>
        )}
      </div>

      {/* Reject modal */}
      {showReject && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowReject(false); setReason(''); } }}
        >
          <div style={{
            background: 'var(--sf-surface)', borderRadius: 16,
            padding: 24, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              Reject loan application
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 16 }}>
              GH₵ {loan.amount_requested.toLocaleString('en-GH', { minimumFractionDigits: 2 })} · {loan.business_id.slice(0, 8).toUpperCase()}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for rejection…"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--sf-line)', background: 'var(--sf-sunken)',
                fontSize: 13, color: 'var(--ink)', resize: 'vertical',
                fontFamily: 'var(--font-body)', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Admin TOTP code (if enabled)</label>
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
            {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowReject(false); setReason(''); }} style={{
                padding: '8px 16px', borderRadius: 9,
                border: '1px solid var(--sf-line)', background: 'transparent',
                fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={handleReject} disabled={!reason.trim() || loanAction.isPending} style={{
                padding: '8px 18px', borderRadius: 9, border: 'none',
                background: reason.trim() ? 'var(--danger)' : 'var(--sf-sunken)',
                color: reason.trim() ? '#fff' : 'var(--ink-4)',
                fontSize: 13, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'not-allowed',
              }}>
                {loanAction.isPending ? 'Rejecting…' : 'Confirm rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Flag modal */}
      {showFlag && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) { setShowFlag(false); setReason(''); } }}
        >
          <div style={{
            background: 'var(--sf-surface)', borderRadius: 16,
            padding: 24, width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
              Flag loan for review
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 16 }}>
              GH₵ {loan.amount_requested.toLocaleString('en-GH', { minimumFractionDigits: 2 })} · {loan.business_id.slice(0, 8).toUpperCase()}
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for flagging…"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10,
                border: '1px solid var(--sf-line)', background: 'var(--sf-sunken)',
                fontSize: 13, color: 'var(--ink)', resize: 'vertical',
                fontFamily: 'var(--font-body)', boxSizing: 'border-box',
              }}
            />
            <div style={{ marginTop: 10 }}>
              <label style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Admin TOTP code (if enabled)</label>
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
            {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 10 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowFlag(false); setReason(''); }} style={{
                padding: '8px 16px', borderRadius: 9,
                border: '1px solid var(--sf-line)', background: 'transparent',
                fontSize: 13, color: 'var(--ink-2)', fontWeight: 600, cursor: 'pointer',
              }}>
                Cancel
              </button>
              <button onClick={handleFlag} disabled={!reason.trim() || loanAction.isPending} style={{
                padding: '8px 18px', borderRadius: 9, border: 'none',
                background: reason.trim() ? '#a16207' : 'var(--sf-sunken)',
                color: reason.trim() ? '#fff' : 'var(--ink-4)',
                fontSize: 13, fontWeight: 700, cursor: reason.trim() ? 'pointer' : 'not-allowed',
              }}>
                {loanAction.isPending ? 'Flagging…' : 'Confirm flag'}
              </button>
            </div>
          </div>
        </div>
      )}
    </td>
  );
}

export default function AdminLoans() {
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);
  const { data, isLoading } = useAdminLoans(statusFilter, page);
  const hasActionableStatus = (s: string) => ['pending', 'pending_partner', 'active', 'approved', 'disbursing'].includes(s);
  const anyActionable = data?.items.some((l) => hasActionableStatus(l.status)) ?? false;

  useEffect(() => {
    setPage(1);
  }, [statusFilter]);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 16,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Finance</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            Lender pipeline
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{data?.total ?? 0} total</span>
      </div>

      <div style={{ padding: '10px 22px', borderBottom: '1px solid var(--sf-line)', display: 'flex', gap: 6, flexWrap: 'wrap', background: 'var(--sf-surface)' }}>
        {STATUS_FILTERS.map((s) => {
          const active = (statusFilter ?? 'all') === s;
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s === 'all' ? undefined : s)}
              style={{
                padding: '5px 12px', borderRadius: 999, border: active ? 'none' : '1px solid var(--sf-line)',
                background: active ? 'var(--ink)' : 'var(--sf-surface)',
                color: active ? '#fdf7eb' : 'var(--ink-3)',
                fontSize: 11.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {statusLabel(s)}
            </button>
          );
        })}
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '16px 22px' }}>
        {isLoading ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>Loading…</div>
        ) : !data?.items.length ? (
          <div style={{ color: 'var(--ink-3)', fontSize: 13, paddingTop: 40, textAlign: 'center' }}>No loan requests found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--sf-line)' }}>
                {['Business', 'Requested', 'Approved', 'Lender', 'Status', 'Date', ...(anyActionable ? ['Actions'] : [])].map((h) => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: 'var(--ink-3)', fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((loan) => {
                const sc = STATUS_COLORS[loan.status] ?? { bg: 'var(--sf-sunken)', color: 'var(--ink-3)' };
                return (
                  <tr key={loan.id} style={{ borderBottom: '1px solid var(--sf-line)' }}>
                    <td style={{ padding: '10px 10px', color: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {loan.business_id.slice(0, 8).toUpperCase()}
                    </td>
                    <td style={{ padding: '10px 10px', fontWeight: 600, color: 'var(--ink)' }}>
                      GH₵ {loan.amount_requested.toLocaleString('en-GH', { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '10px 10px', color: loan.amount_approved ? 'var(--ink)' : 'var(--ink-3)' }}>
                      {loan.amount_approved
                        ? `GH₵ ${loan.amount_approved.toLocaleString('en-GH', { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td style={{ padding: '10px 10px', color: 'var(--ink-3)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {loan.lender_id ?? '—'}
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span style={{
                        padding: '3px 8px', borderRadius: 999,
                        background: sc.bg, color: sc.color,
                        fontSize: 11, fontWeight: 600,
                      }}>
                        {statusLabel(loan.status)}
                      </span>
                    </td>
                    <td style={{ padding: '10px 10px', color: 'var(--ink-3)' }}>
                      {relTime(loan.created_at)}
                    </td>
                    {anyActionable && <LoanActions loan={loan} />}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} style={pagerStyle(page <= 1)}>Previous</button>
          <button onClick={() => setPage((p) => p + 1)} disabled={(data?.items.length ?? 0) < 25 || (data?.total ?? 0) <= page * 25} style={pagerStyle((data?.items.length ?? 0) < 25 || (data?.total ?? 0) <= page * 25)}>Next</button>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', alignSelf: 'center', marginLeft: 8 }}>
            Page {page} · {data?.total ?? 0} loans
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
