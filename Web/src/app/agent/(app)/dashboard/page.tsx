'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAgentCommissionSummary, useAgentTradersList, useAgentWallet } from '@/hooks/agent/useAgentData';

type Tone = 'warn' | 'success' | 'neutral' | 'danger';

type Period = 'day' | 'week' | 'month';


function kycToStep(status: string) {
  if (status === 'verified' || status === 'approved') return 5;
  if (status === 'submitted') return 4;
  if (status === 'pending') return 3;
  return 2;
}
function kycToTone(status: string): Tone {
  if (status === 'verified' || status === 'approved') return 'success';
  if (status === 'submitted') return 'warn';
  if (status === 'rejected' || status === 'failed') return 'danger';
  return 'neutral';
}
function kycToLabel(status: string) {
  if (status === 'verified' || status === 'approved') return 'Verified';
  if (status === 'submitted') return 'KYC pending';
  if (status === 'rejected') return 'Rejected';
  return 'Started';
}

function tonePill(tone: Tone, label: string) {
  const map = {
    warn:    'sf-pill sf-pill-warn',
    success: 'sf-pill sf-pill-success',
    neutral: 'sf-pill sf-pill-neutral',
    danger:  'sf-pill sf-pill-danger',
  };
  return <span className={map[tone]}>{label}</span>;
}

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return 'Not scheduled';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function AgentDashboard() {
  const router = useRouter();
  const [period, setPeriod] = useState<Period>('month');
  const { data: summary, isLoading } = useAgentCommissionSummary(period);
  const { data: tradersRaw } = useAgentTradersList();
  const { data: wallet } = useAgentWallet();

  const tradersArr = Array.isArray(tradersRaw) ? tradersRaw : [];
  const PIPELINE = tradersArr.slice(0, 5).map((t) => ({
    name: t.business_name ?? `Trader ${t.id.slice(-4)}`,
    biz:  t.business_name ?? '—',
    loc:  '—',
    step: kycToStep(t.kyc_status),
    status: kycToLabel(t.kyc_status),
    tone: kycToTone(t.kyc_status),
  }));

  const onboarded = isLoading ? null : (summary?.onboarded ?? 0);
  const target = 40;
  const pct = onboarded !== null && onboarded > 0 ? Math.round((Number(onboarded) / target) * 100) : 0;
  const commission = isLoading ? null : Number(summary?.earned ?? 0);
  const pending = Number(wallet?.pending_balance ?? summary?.pending ?? 0);

  const activeTrader = tradersArr.find(t => t.kyc_status === 'submitted' || t.kyc_status === 'pending') ?? tradersArr[0];
  const dynamicSteps = activeTrader ? [
    { l: 'Phone & OTP',        d: 'Verified',                                                             done: true,  active: false },
    { l: 'Business profile',   d: activeTrader.business_name ?? '—',                                     done: true,  active: false },
    { l: 'Ghana Card + photo', d: activeTrader.kyc_status !== 'pending' ? 'Uploaded' : 'Required',        done: activeTrader.kyc_status !== 'pending', active: activeTrader.kyc_status === 'pending' },
    { l: 'KYC review',         d: activeTrader.kyc_status === 'submitted' ? 'Under review' : activeTrader.kyc_status === 'verified' ? 'Approved' : 'Awaiting submission', done: ['verified', 'approved'].includes(activeTrader.kyc_status), active: activeTrader.kyc_status === 'submitted' },
    { l: 'MoMo wallet link',   d: activeTrader.kyc_status === 'verified' ? 'Ready to link' : 'Pending',  done: false, active: false },
  ] : null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: 56, padding: '0 22px',
        borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 11,
            background: 'var(--gold)', color: '#1a1208',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, fontSize: 12,
            fontFamily: 'var(--font-display)',
            flexShrink: 0,
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Agent
            </div>
            <div className="sf-display" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>My Dashboard</div>
          </div>
        </div>
        <span className="sf-pill sf-pill-brand" style={{ marginLeft: 4 }}>Active</span>
        <div style={{ flex: 1 }} />

        {/* Period switcher */}
        <div style={{ display: 'flex', gap: 2, padding: '3px', background: 'var(--sf-sunken)', borderRadius: 9 }}>
          {(['day', 'week', 'month'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                all: 'unset', cursor: 'pointer',
                padding: '5px 12px', borderRadius: 7,
                background: period === p ? 'var(--sf-surface)' : 'transparent',
                color: period === p ? 'var(--ink)' : 'var(--ink-3)',
                fontSize: 12, fontWeight: 600,
                transition: 'background 0.1s',
                boxShadow: period === p ? '0 1px 3px rgba(0,0,0,0.07)' : 'none',
              }}
            >
              {p === 'day' ? 'Today' : p === 'week' ? 'This week' : 'This month'}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
        {/* Performance hero */}
        <div style={{
          background: 'var(--sf-surface)',
          border: '1px solid var(--sf-line)',
          borderRadius: 16, padding: 18, marginBottom: 16,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {period === 'day' ? 'Today' : period === 'week' ? 'This week' : 'This month'}
              </div>
              {onboarded === null ? (
                <div style={{ height: 40, width: 120, background: 'var(--sf-sunken)', borderRadius: 6, marginTop: 4 }} />
              ) : (
                <div className="sf-display sf-num" style={{ fontSize: 36, fontWeight: 600, marginTop: 2, letterSpacing: '-0.025em', color: 'var(--ink)' }}>
                  {onboarded} <span style={{ fontSize: 22, color: 'var(--ink-3)', fontWeight: 500 }}>/ {target}</span>
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>traders onboarded</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>Commission</div>
              {commission === null ? (
                <div style={{ height: 28, width: 100, background: 'var(--sf-sunken)', borderRadius: 6, marginTop: 4 }} />
              ) : (
                <div className="sf-display sf-num" style={{ fontSize: 26, fontWeight: 600, color: 'var(--brand)', marginTop: 2 }}>
                  GH₵ {commission.toLocaleString()}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 1 }}>≈ GH₵ {onboarded ? Math.round(Number(commission ?? 0) / Number(onboarded)).toLocaleString() : 20} / trader</div>
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 14, height: 6, borderRadius: 999, background: 'var(--sf-sunken)', overflow: 'hidden' }}>
            <div style={{
              width: `${pct}%`, height: '100%',
              background: 'linear-gradient(90deg, var(--brand) 0%, var(--gold) 100%)',
              transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 600 }}>
            <span>{onboarded ?? 0}</span>
            <span>{target - Number(onboarded ?? 0)} to bonus</span>
          </div>
        </div>

        {/* CTAs */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8, marginBottom: 18 }}>
          <button style={{
            padding: '12px 16px', borderRadius: 12, border: 'none',
            background: 'var(--brand)', color: '#fff',
            fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            transition: 'background 0.1s',
          }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-2)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand)')}
            onClick={() => router.push('/agent/onboarding')}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Onboard new trader
          </button>
        </div>

        {/* Two-column lower section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
          {/* Active pipeline */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Active pipeline · {tradersArr.length}
            </div>
            <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
              {PIPELINE.length === 0 && (
                <div style={{ padding: '32px 16px', textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>No traders in pipeline yet</div>
                  <button
                    onClick={() => router.push('/agent/onboarding')}
                    style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Onboard first trader
                  </button>
                </div>
              )}
              {PIPELINE.map((t, i, a) => (
                <div key={t.name} style={{
                  padding: '12px 14px',
                  borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  display: 'flex', gap: 10,
                  cursor: 'pointer', transition: 'background 0.1s',
                }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
                >
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'var(--sf-sunken)', color: 'var(--ink-2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11.5, fontWeight: 700,
                    fontFamily: 'var(--font-display)',
                    flexShrink: 0,
                  }}>
                    {t.name.split(' ').map(w => w[0]).join('')}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{t.biz}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{t.name} · {t.loc}</div>
                    <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 3 }}>
                      {[1,2,3,4,5].map(s => (
                        <div key={s} style={{
                          flex: 1, height: 4, borderRadius: 2,
                          background: s <= t.step ? 'var(--brand)' : 'var(--sf-sunken)',
                        }} />
                      ))}
                    </div>
                  </div>
                  {tonePill(t.tone, t.status)}
                </div>
              ))}
            </div>

            {/* Wallet */}
            {pending !== null && (
              <div style={{
                marginTop: 12, padding: '12px 14px', borderRadius: 12,
                background: 'var(--gold-soft)', border: '1px solid var(--sf-line)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--gold-2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Commission wallet</div>
                  <div className="sf-display sf-num" style={{ fontSize: 20, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>{money(wallet?.available_balance)}</div>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>
                    Pending hold {money(pending)} · Next {shortDate(wallet?.next_payout_date)}
                  </div>
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold-2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1.5"/>
                </svg>
              </div>
            )}
          </div>

          {/* Onboarding stepper */}
          <div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              {activeTrader ? `Onboarding · ${activeTrader.business_name ?? 'Trader'}` : 'Onboarding progress'}
            </div>
            <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
              {!dynamicSteps ? (
                <div style={{ padding: '16px 0', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                  No active onboarding.<br />
                  <span
                    style={{ color: 'var(--brand)', cursor: 'pointer', fontWeight: 600 }}
                    onClick={() => router.push('/agent/onboarding')}
                  >
                    Start one now →
                  </span>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {dynamicSteps.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                      <div style={{
                        width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                        background: s.done ? 'var(--brand)' : s.active ? 'var(--gold-soft)' : 'var(--sf-sunken)',
                        color: s.done ? '#fff' : s.active ? 'var(--gold-2)' : 'var(--ink-3)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 700,
                        border: s.active ? '2px solid var(--gold)' : 'none',
                      }}>
                        {s.done ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                        ) : i + 1}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontSize: 13, fontWeight: s.active ? 600 : 500,
                          color: s.done ? 'var(--ink-3)' : 'var(--ink)',
                        }}>
                          {s.l}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{s.d}</div>
                      </div>
                      {s.active && (
                        <span className="sf-pill sf-pill-warn" style={{ fontSize: 10, marginTop: 2 }}>Active</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
