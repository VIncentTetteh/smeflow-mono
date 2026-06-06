'use client';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { fetchFraudSignals } from '@/lib/adminApi';

function Severity({ level }: { level: string }) {
  const cls = level === 'high' ? 'sf-pill-danger' : level === 'med' ? 'sf-pill-warn' : 'sf-pill-success';
  return <span className={`sf-pill ${cls}`} style={{ fontSize: 10.5 }}>{level.toUpperCase()}</span>;
}

export default function AdminRiskPage() {
  const router = useRouter();
  const { data = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['admin', 'risk', 'fraud-signals'],
    queryFn: fetchFraudSignals,
    refetchInterval: 60_000,
  });

  const high = data.filter((item) => item.severity === 'high').length;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Security</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Risk operations</div>
        </div>
        <div style={{ flex: 1 }} />
        <span className={high > 0 ? 'sf-pill sf-pill-danger' : 'sf-pill sf-pill-success'}>{high} high severity</span>
        <button onClick={() => void refetch()} disabled={isFetching} style={{
          padding: '7px 14px', borderRadius: 9, border: '1px solid var(--sf-line-2)',
          background: 'var(--sf-surface)', color: 'var(--ink-2)', fontSize: 12, fontWeight: 700,
          cursor: isFetching ? 'not-allowed' : 'pointer',
        }}>
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 90px 120px 120px',
            gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Business</div><div>Signal</div><div>Severity</div><div>Flagged</div><div />
          </div>

          {isLoading && <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>Loading risk signals…</div>}
          {isError && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--danger)', fontSize: 13 }}>
              Could not load risk signals. <button onClick={() => void refetch()} style={{ all: 'unset', cursor: 'pointer', color: 'var(--brand)', fontWeight: 700 }}>Retry</button>
            </div>
          )}
          {!isLoading && !isError && data.length === 0 && (
            <div style={{ padding: 48, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No active fraud signals</div>
          )}
          {data.map((item, i, a) => (
            <div key={`${item.business_id}-${item.signal}`} style={{
              display: 'grid', gridTemplateColumns: '1.1fr 1.4fr 90px 120px 120px',
              gap: 10, padding: '13px 18px',
              borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
              alignItems: 'center', fontSize: 12.5,
            }}>
              <div>
                <div style={{ fontWeight: 700, color: 'var(--ink)' }}>{item.business_name}</div>
                <div className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 10.5 }}>{item.business_id.slice(0, 8).toUpperCase()}</div>
              </div>
              <div>
                <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{item.signal}</div>
                <div style={{ color: 'var(--ink-3)', marginTop: 2 }}>{item.detail}</div>
              </div>
              <Severity level={item.severity} />
              <span style={{ color: 'var(--ink-3)', fontSize: 11 }}>
                {new Date(item.flagged_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
              <button onClick={() => router.push(`/admin/businesses/${item.business_id}`)} style={{
                padding: '6px 12px', borderRadius: 8,
                border: '1px solid var(--sf-line)', background: 'transparent',
                color: 'var(--ink-2)', fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>
                Review business
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
