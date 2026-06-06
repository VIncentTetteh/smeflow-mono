'use client';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import Link from 'next/link';
import { useAgentCommissions, useMarkCommissionPaid } from '@/hooks/admin/useAdminPeople';

function CommissionsTable({ agentId }: { agentId: string }) {
  const { data: commissions = [], isLoading } = useAgentCommissions(agentId);
  const markPaid = useMarkCommissionPaid();

  return (
    <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '1.2fr 120px 1fr 140px 90px 100px',
        gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
        fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        <div>Event</div><div>Amount</div><div>Business</div><div>Date</div><div>Status</div><div />
      </div>

      {isLoading ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '1.2fr 120px 1fr 140px 90px 100px',
            gap: 10, padding: '14px 18px', borderBottom: i < 4 ? '1px solid var(--sf-line)' : 'none',
            alignItems: 'center',
          }}>
            {Array.from({ length: 5 }).map((__, j) => (
              <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4 }} />
            ))}
            <div />
          </div>
        ))
      ) : commissions.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
          No commissions found for this agent
        </div>
      ) : (
        commissions.map((c, i, a) => (
          <div key={c.id} style={{
            display: 'grid', gridTemplateColumns: '1.2fr 120px 1fr 140px 90px 100px',
            gap: 10, padding: '13px 18px',
            borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
            alignItems: 'center', fontSize: 13,
            transition: 'background 0.1s',
          }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
          >
            <span style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>
              {c.event_type.replace(/_/g, ' ')}
            </span>
            <span className="sf-num" style={{ fontWeight: 700, color: 'var(--brand)' }}>
              GH₵ {Number(c.amount).toFixed(2)}
            </span>
            <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.business_name ?? c.business_id}
            </span>
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              {new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
            <span className={`sf-pill ${c.paid ? 'sf-pill-success' : 'sf-pill-warn'}`}>{c.paid ? 'Paid' : 'Pending'}</span>
            <div style={{ textAlign: 'right' }}>
              {!c.paid && (
                <button
                  disabled={markPaid.isPending}
                  onClick={() => markPaid.mutate({ agentId, commissionId: c.id })}
                  style={{
                    all: 'unset', cursor: markPaid.isPending ? 'not-allowed' : 'pointer',
                    padding: '5px 10px', borderRadius: 7, border: '1px solid var(--sf-line-2)',
                    fontSize: 11.5, fontWeight: 600, color: markPaid.isPending ? 'var(--ink-4)' : 'var(--ink-2)',
                    background: 'var(--sf-surface)',
                  }}
                >
                  Mark paid
                </button>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CommissionsContent() {
  const params = useSearchParams();
  const agentId = params.get('agent') ?? '';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Finance</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Agent commissions</div>
        </div>
        {agentId && (
          <span className="sf-mono sf-pill sf-pill-neutral" style={{ fontSize: 11 }}>{agentId.slice(0, 12)}</span>
        )}
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        {!agentId ? (
          <div style={{
            background: 'var(--sf-surface)', border: '1px solid var(--sf-line)',
            borderRadius: 14, padding: '48px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>
              Select an agent to view their commissions
            </div>
            <Link href="/admin/agents" style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', borderRadius: 9, border: 'none',
              background: 'var(--ink)', color: '#f5efe1',
              fontSize: 13, fontWeight: 600, textDecoration: 'none',
            }}>
              View agents →
            </Link>
          </div>
        ) : (
          <CommissionsTable agentId={agentId} />
        )}
      </div>
    </div>
  );
}

export default function AdminCommissions() {
  return (
    <Suspense fallback={
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
        Loading…
      </div>
    }>
      <CommissionsContent />
    </Suspense>
  );
}
