'use client';
import { useAgentCommissions, useAgentPayoutHistory, useAgentWallet } from '@/hooks/agent/useAgentData';

type CommissionRow = {
  id: string;
  event_type: string;
  amount: number;
  business: string;
  date: string;
  status: string;
  available_at?: string | null;
};

const STATIC_COMMISSIONS: CommissionRow[] = [
  { id: '', event_type: 'merchant_onboarded', amount: 20, business: 'Esi Wholesale', date: '5 May 2026', status: 'paid', available_at: null },
  { id: '', event_type: 'merchant_onboarded', amount: 20, business: 'MI Pharmacy', date: '4 May 2026', status: 'paid', available_at: null },
  { id: '', event_type: 'kyc_completed', amount: 10, business: 'Akua Pokuah Foods', date: '3 May 2026', status: 'available', available_at: null },
  { id: '', event_type: 'merchant_onboarded', amount: 20, business: 'Tanko Provisions', date: '2 May 2026', status: 'pending', available_at: '2026-05-04T10:00:00Z' },
  { id: '', event_type: 'first_sale', amount: 5, business: 'KB Auto Spares', date: '1 May 2026', status: 'paid', available_at: null },
];

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusClass(status: string) {
  if (status === 'paid' || status === 'success' || status === 'completed') return 'sf-pill sf-pill-success';
  if (status === 'failed' || status === 'reversed') return 'sf-pill sf-pill-danger';
  if (status === 'available') return 'sf-pill sf-pill-brand';
  return 'sf-pill sf-pill-warn';
}

export default function AgentCommissions() {
  const { data: raw } = useAgentCommissions();
  const { data: wallet } = useAgentWallet();
  const { data: payoutHistory = [] } = useAgentPayoutHistory();

  const items: CommissionRow[] = (Array.isArray(raw) && raw.length > 0)
    ? raw.map((c) => ({
        id: c.id,
        event_type: c.event_type,
        amount: Number(c.amount),
        business: c.business_name ?? c.business_id ?? '—',
        date: new Date(c.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
        status: c.status,
        available_at: c.available_at,
      }))
    : STATIC_COMMISSIONS;

  const totalEarned = items.reduce((s, c) => s + c.amount, 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center',
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Agent</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>My commissions</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Total earned</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, marginTop: 4, color: 'var(--ink)' }}>
              {money(wallet?.total_commission_earned ?? totalEarned)}
            </div>
          </div>
          <div style={{ background: 'var(--gold-soft)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 10.5, color: 'var(--gold-2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Pending hold</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, marginTop: 4, color: 'var(--ink)' }}>
              {money(wallet?.pending_balance)}
            </div>
          </div>
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Available</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, marginTop: 4, color: 'var(--brand)' }}>
              {money(wallet?.available_balance)}
            </div>
          </div>
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next payout</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, marginTop: 8, color: 'var(--ink)' }}>
              {shortDate(wallet?.next_payout_date)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 4 }}>
              Threshold {money(wallet?.payout_threshold)}
            </div>
          </div>
        </div>

        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.2fr 100px 1fr 140px 90px',
            gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Event</div><div>Amount</div><div>Business</div><div>Date</div><div>Status</div>
          </div>

          {items.map((c, i, a) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '1.2fr 100px 1fr 140px 90px',
              gap: 10, padding: '13px 18px',
              borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
              alignItems: 'center', fontSize: 13,
              transition: 'background 0.1s',
            }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              <span style={{ color: 'var(--ink)', textTransform: 'capitalize' }}>{c.event_type.replace(/_/g, ' ')}</span>
              <span className="sf-num" style={{ fontWeight: 700, color: 'var(--brand)' }}>{money(c.amount)}</span>
              <span style={{ color: 'var(--ink-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.business}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{c.status === 'pending' && c.available_at ? `Available ${shortDate(c.available_at)}` : c.date}</span>
              <span className={statusClass(c.status)}>{c.status}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 18, background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--sf-line)', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
            Payout history
          </div>
          {payoutHistory.length === 0 ? (
            <div style={{ padding: 18, fontSize: 13, color: 'var(--ink-3)' }}>No payouts have been sent yet.</div>
          ) : payoutHistory.map((p, i, a) => (
            <div key={p.batch_id} style={{
              display: 'grid', gridTemplateColumns: '120px 1fr 140px 100px',
              gap: 10, padding: '13px 18px',
              borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
              alignItems: 'center', fontSize: 13,
            }}>
              <span className="sf-num" style={{ fontWeight: 700, color: 'var(--ink)' }}>{money(p.amount_ghs)}</span>
              <span style={{ color: 'var(--ink-3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.transfer_code ?? p.batch_id}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{shortDate(p.completed_at ?? p.payout_date)}</span>
              <span className={statusClass(p.status)}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
