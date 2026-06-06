'use client';
import { useRouter } from 'next/navigation';
import { useAgentCommissionSummary, useAgentTradersList } from '@/hooks/agent/useAgentData';


type Tone = 'warn' | 'success' | 'neutral' | 'danger';
const toneClass: Record<Tone, string> = {
  warn: 'sf-pill-warn', success: 'sf-pill-success', neutral: 'sf-pill-neutral', danger: 'sf-pill-danger',
};

export default function AgentTraders() {
  const router = useRouter();
  const { data: summary } = useAgentCommissionSummary('month');
  const { data: tradersRaw, isLoading } = useAgentTradersList();

  const traders = (Array.isArray(tradersRaw) ? tradersRaw : []).map((t) => ({
    name: t.business_name ?? `Trader ${t.id.slice(-4)}`,
    biz: t.business_name ?? '—',
    loc: '—',
    step: t.kyc_status === 'verified' ? 5 : t.kyc_status === 'submitted' ? 4 : t.kyc_status === 'pending' ? 3 : 2,
    status: t.kyc_status === 'verified' ? 'Verified' : t.kyc_status === 'submitted' ? 'KYC pending' : 'Started',
    tone: (t.kyc_status === 'verified' ? 'success' : t.kyc_status === 'submitted' ? 'warn' : t.kyc_status === 'rejected' ? 'danger' : 'neutral') as Tone,
  }));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Agent</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            My traders <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>· {summary?.onboarded ?? traders.length} onboarded</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => router.push('/agent/onboarding')}
          style={{
            padding: '8px 16px', borderRadius: 9, border: 'none',
            background: 'var(--brand)', color: '#fff',
            fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14"/>
          </svg>
          Onboard new
        </button>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.5fr 1fr 80px 100px',
            gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Trader</div><div>Location</div><div>Progress</div><div>Status</div>
          </div>

          {isLoading && <div style={{ padding: 24, textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>Loading traders…</div>}
          {!isLoading && traders.length === 0 && (
            <div style={{ padding: '40px 16px', textAlign: 'center' }}>
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 12 }}>No traders onboarded yet</div>
              <button
                onClick={() => router.push('/agent/onboarding')}
                style={{ padding: '8px 16px', borderRadius: 9, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}
              >
                Onboard your first trader
              </button>
            </div>
          )}
          {traders.map((t, i, a) => (
            <div key={t.name} style={{
              display: 'grid', gridTemplateColumns: '1.5fr 1fr 80px 100px',
              gap: 10, padding: '13px 18px',
              borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
              alignItems: 'center', fontSize: 13,
              transition: 'background 0.1s', cursor: 'pointer',
            }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: '50%',
                  background: 'var(--sf-sunken)', color: 'var(--ink-2)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-display)', flexShrink: 0,
                }}>
                  {t.name.split(' ').map(w => w[0]).join('')}
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{t.biz}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{t.name}</div>
                </div>
              </div>
              <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{t.loc}</span>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1,2,3,4,5].map(s => (
                  <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= t.step ? 'var(--brand)' : 'var(--sf-sunken)' }} />
                ))}
              </div>
              <span className={`sf-pill ${toneClass[t.tone as Tone]}`} style={{ fontSize: 10.5 }}>{t.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
