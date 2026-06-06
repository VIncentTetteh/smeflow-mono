'use client';
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAuditLogs } from '@/hooks/admin/useAdminQueues';

export default function AdminAuditLogs() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [action, setAction] = useState(searchParams.get('action') ?? '');
  const { data, isLoading } = useAuditLogs(page, action || undefined);
  const logs = data?.items ?? [];
  const setFilter = (next: string) => {
    setAction(next);
    setPage(1);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Compliance</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Audit log</div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Page {page}</span>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {[
            ['', 'All events'],
            ['payout', 'Payouts'],
            ['settlement', 'Settlements'],
            ['dva', 'DVA'],
            ['disbursement', 'Loan disbursement'],
            ['repayment', 'Repayments'],
            ['lender', 'Lender split'],
          ].map(([value, label]) => {
            const active = action === value;
            return (
              <button key={value || 'all'} onClick={() => setFilter(value)} style={{ padding: '6px 12px', borderRadius: 999, border: active ? 'none' : '1px solid var(--sf-line)', background: active ? 'var(--ink)' : 'var(--sf-surface)', color: active ? '#fdf7eb' : 'var(--ink-3)', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          {/* Header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '150px 1fr 1.2fr 1fr 120px 70px',
            gap: 8, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Timestamp</div><div>Actor</div><div>Action</div><div>Resource</div><div>IP</div><div>Result</div>
          </div>

          {isLoading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading…</div>
          ) : logs.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No audit logs found</div>
          ) : (
            logs.map((log, i, a) => (
              <div key={log.id} style={{
                display: 'grid', gridTemplateColumns: '150px 1fr 1.2fr 1fr 120px 70px',
                gap: 8, padding: '11px 18px',
                borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                alignItems: 'center', fontSize: 12.5,
                transition: 'background 0.1s',
              }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11, whiteSpace: 'nowrap' }}>
                  {new Date(log.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.actor_email ?? log.actor_id ?? '—'}
                </span>
                <span className="sf-mono" style={{
                  fontSize: 11, color: 'var(--ink-2)',
                  padding: '2px 7px', background: 'var(--sf-sunken)', borderRadius: 5,
                  display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {log.action}
                </span>
                <span style={{ color: 'var(--ink-3)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {log.resource_type ?? '—'}/{log.resource_id ?? '—'}
                </span>
                <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{log.ip_address ?? '—'}</span>
                <span className={`sf-pill ${log.success ? 'sf-pill-success' : 'sf-pill-danger'}`} style={{ fontSize: 10 }}>
                  {log.success ? 'OK' : 'FAIL'}
                </span>
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          {[
            { label: '← Previous', disabled: page <= 1, onClick: () => setPage((p) => p - 1) },
            { label: 'Next →', disabled: logs.length < 50, onClick: () => setPage((p) => p + 1) },
          ].map(({ label, disabled, onClick }) => (
            <button key={label} onClick={onClick} disabled={disabled} style={{
              padding: '7px 16px', borderRadius: 9, border: '1px solid var(--sf-line-2)',
              background: 'var(--sf-surface)', color: disabled ? 'var(--ink-4)' : 'var(--ink-2)',
              fontSize: 12.5, fontWeight: 600, cursor: disabled ? 'not-allowed' : 'pointer',
            }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
