'use client';
import { useState } from 'react';
import { useLenderBusinesses, useLenderCreditProfile } from '@/hooks/lender/useLenderData';

type LenderBusiness = {
  business_ref: string;
  credit_band: string;
  account_age_days: number;
  has_active_loan: boolean;
  consented_at: string;
};

const CHART_H = 72;

function bandColor(band: string): string {
  if (band === 'A') return 'var(--brand)';
  if (band === 'B') return 'var(--brand)';
  if (band === 'C') return 'var(--gold-2, #d4a017)';
  if (band === 'D') return 'var(--gold-2, #d4a017)';
  return 'var(--danger)';
}

function bandBg(band: string): string {
  if (band === 'A' || band === 'B') return 'color-mix(in srgb, var(--brand) 10%, transparent)';
  if (band === 'C' || band === 'D') return 'color-mix(in srgb, var(--gold-2, #d4a017) 12%, transparent)';
  return 'color-mix(in srgb, var(--danger) 10%, transparent)';
}

function formatAge(days: number): string {
  if (days >= 365) {
    const y = Math.floor(days / 365);
    return `${y} yr${y !== 1 ? 's' : ''}`;
  }
  if (days >= 30) {
    const m = Math.floor(days / 30);
    return `${m} mo`;
  }
  return `${days} days`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function CreditPanel({ bizId, onClose }: { bizId: string; onClose: () => void }) {
  const { data: profile, isLoading } = useLenderCreditProfile(bizId);

  const chartData = profile?.monthly_revenue ?? [];
  const chartValues = chartData.map((m) => m.amount / 1000);
  const chartMonths = chartData.map((m) => m.month.slice(0, 3));
  const maxRev = Math.max(...chartValues, 1);

  return (
    <div style={{
      width: 340, background: 'var(--sf-surface)',
      borderLeft: '1px solid var(--sf-line)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', flexShrink: 0,
    }}>
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--sf-line)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em' }}>Credit profile</div>
          <div className="sf-display" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', marginTop: 1 }}>
            Trader {bizId.slice(-6).toUpperCase()}
          </div>
        </div>
        <button onClick={onClose} style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
        {isLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[80, 60, 120, 100].map((w, i) => (
              <div key={i} style={{ height: 14, width: `${w}%`, background: 'var(--sf-sunken)', borderRadius: 4 }} />
            ))}
          </div>
        ) : !profile ? (
          <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', marginTop: 32 }}>No credit data available.</p>
        ) : (
          <>
            {/* Score tile */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
              <div style={{ padding: 10, background: 'var(--sf-sunken)', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Score · Band</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                  <span className="sf-num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>{profile.credit_score}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand)', background: 'color-mix(in srgb, var(--brand) 10%, transparent)', padding: '1px 5px', borderRadius: 4 }}>
                    {profile.score_band}
                  </span>
                </div>
              </div>
              <div style={{ padding: 10, background: 'var(--sf-sunken)', borderRadius: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>KYC status</div>
                <span className={`sf-pill ${profile.kyc_status === 'verified' ? 'sf-pill-success' : profile.kyc_status === 'submitted' ? 'sf-pill-warn' : 'sf-pill-neutral'}`} style={{ fontSize: 11 }}>
                  {profile.kyc_status}
                </span>
              </div>
            </div>

            {/* Revenue chart */}
            {chartValues.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Monthly revenue
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_H, marginBottom: 4 }}>
                  {chartValues.map((v, i) => (
                    <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                      <div style={{
                        height: Math.max(3, Math.round((v / maxRev) * CHART_H)),
                        borderRadius: '2px 2px 0 0',
                        background: i === chartValues.length - 1 ? 'var(--brand)' : 'var(--brand-soft-2)',
                      }} />
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 3 }}>
                  {chartMonths.map((m, i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 8, color: 'var(--ink-4)', fontWeight: 600 }}>
                      {i === 0 || i === chartMonths.length - 1 ? m : ''}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk indicators */}
            {profile.risk_indicators?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 8 }}>
                  Risk indicators
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {profile.risk_indicators.map((r) => (
                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.label}</span>
                      <span className={`sf-pill sf-pill-${r.tone === 'success' ? 'success' : r.tone === 'danger' ? 'danger' : r.tone === 'warn' ? 'warn' : 'neutral'}`} style={{ fontSize: 10.5 }}>
                        {r.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function LenderBusinesses() {
  const { data, isLoading } = useLenderBusinesses();
  const [detailBizId, setDetailBizId] = useState<string | null>(null);

  const items: LenderBusiness[] = data?.items ?? [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Lender</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            Consented businesses <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>· {data?.total ?? items.length}</span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 34,
          background: 'var(--sf-sunken)', border: '1px solid var(--sf-line)', borderRadius: 9,
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="search"
            placeholder="Search businesses…"
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--ink)', width: 180 }}
          />
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              display: 'grid', gridTemplateColumns: '2fr 100px 140px 120px 120px 80px',
              gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
              fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <div>Business ref</div>
              <div>Band</div>
              <div>Account age</div>
              <div>Active loan</div>
              <div>Consented at</div>
              <div>Action</div>
            </div>

            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{
                  display: 'grid', gridTemplateColumns: '2fr 100px 140px 120px 120px 80px',
                  gap: 10, padding: '13px 18px',
                  borderBottom: i < 4 ? '1px solid var(--sf-line)' : 'none',
                  alignItems: 'center',
                }}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4, width: j === 0 ? '80%' : '60%' }} />
                  ))}
                </div>
              ))
            ) : items.length === 0 ? (
              <div style={{ padding: '40px 18px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
                No consented businesses yet
              </div>
            ) : items.map((b, i, a) => (
              <div key={b.business_ref} style={{
                display: 'grid', gridTemplateColumns: '2fr 100px 140px 120px 120px 80px',
                gap: 10, padding: '13px 18px',
                borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                alignItems: 'center', fontSize: 13,
                transition: 'background 0.1s', cursor: 'pointer',
              }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
              >
                {/* Business ref + pseudonym */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    background: 'var(--brand-soft)', color: 'var(--brand)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                  }}>
                    {b.business_ref.slice(-2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Trader {b.business_ref.slice(-6).toUpperCase()}</div>
                    <div className="sf-mono" style={{ fontSize: 10, color: 'var(--ink-4)', marginTop: 1 }}>…{b.business_ref.slice(-12)}</div>
                  </div>
                </div>

                {/* Credit band pill */}
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 12, fontWeight: 700,
                  color: bandColor(b.credit_band),
                  background: bandBg(b.credit_band),
                  borderRadius: 6, padding: '2px 10px',
                  width: 'fit-content',
                }}>
                  {b.credit_band}
                </span>

                {/* Account age */}
                <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>
                  {formatAge(b.account_age_days)}
                </span>

                {/* Active loan indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: b.has_active_loan ? 'var(--brand)' : 'var(--sf-line-2)',
                    flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 12, color: b.has_active_loan ? 'var(--brand)' : 'var(--ink-4)' }}>
                    {b.has_active_loan ? 'Active' : 'None'}
                  </span>
                </div>

                {/* Consented at */}
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{shortDate(b.consented_at)}</span>

                {/* Action button */}
                <button
                  onClick={() => setDetailBizId(detailBizId === b.business_ref ? null : b.business_ref)}
                  style={{
                    all: 'unset', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, color: 'var(--brand)',
                    padding: '4px 10px', borderRadius: 7,
                    border: '1px solid var(--brand)',
                    transition: 'background 0.1s',
                    background: detailBizId === b.business_ref ? 'var(--brand-soft)' : 'transparent',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-soft)')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = detailBizId === b.business_ref ? 'var(--brand-soft)' : 'transparent')}
                >
                  {detailBizId === b.business_ref ? 'Close' : 'View'}
                </button>
              </div>
            ))}
          </div>
        </div>
        {detailBizId && (
          <CreditPanel
            bizId={detailBizId}
            onClose={() => setDetailBizId(null)}
          />
        )}
      </div>
    </div>
  );
}
