'use client';
import { useAuditLogs } from '@/hooks/admin/useAdminQueues';

function toneFromLog(action: string, success: boolean): string {
  if (!success) return 'danger';
  if (action.includes('approve') || action.includes('onboard') || action.includes('verified')) return 'success';
  if (action.includes('disburs') || action.includes('loan') || action.includes('settlement')) return 'brand';
  if (action.includes('reject') || action.includes('fraud') || action.includes('flag') || action.includes('disable')) return 'danger';
  return 'neutral';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function formatTitle(action: string): string {
  return action
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatBody(log: { action: string; resource_type: string | null; resource_id: string | null; actor_email: string | null }): string {
  const parts: string[] = [];
  if (log.resource_type) parts.push(log.resource_type);
  if (log.resource_id) parts.push(`#${log.resource_id.slice(-6)}`);
  if (log.actor_email) parts.push(`by ${log.actor_email}`);
  return parts.join(' · ') || '—';
}

export default function AdminNotifications() {
  const { data: logs, isLoading } = useAuditLogs();
  const items = Array.isArray(logs?.items) ? logs!.items.slice(0, 20) : [];

  const toneMap: Record<string, string> = {
    success: 'sf-pill-success', brand: 'sf-pill-brand', neutral: 'sf-pill-neutral', danger: 'sf-pill-danger',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>System</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Notifications</div>
        </div>
        <span className="sf-pill sf-pill-gold">Today</span>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden', maxWidth: 640 }}>
          {isLoading && (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
              Loading…
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <div style={{ padding: '32px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
              No activity yet
            </div>
          )}
          {items.map((log, i) => {
            const tone = toneFromLog(log.action, log.success);
            return (
              <div key={log.id} style={{
                display: 'flex', gap: 14, padding: '14px 18px',
                borderBottom: i < items.length - 1 ? '1px solid var(--sf-line)' : 'none',
                alignItems: 'flex-start',
                transition: 'background 0.1s', cursor: 'default',
              }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', marginTop: 5, flexShrink: 0,
                  background: tone === 'danger' ? 'var(--danger)' : tone === 'success' || tone === 'brand' ? 'var(--brand)' : 'var(--sf-line-2)',
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{formatTitle(log.action)}</span>
                    <span className={`sf-pill ${toneMap[tone]}`} style={{ fontSize: 10 }}>{tone}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>{formatBody(log)}</div>
                </div>
                <span className="sf-mono" style={{ fontSize: 11, color: 'var(--ink-4)', flexShrink: 0, marginTop: 2 }}>
                  {formatTime(log.created_at)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
