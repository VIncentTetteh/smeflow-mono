'use client';
import { useState } from 'react';
import { useLenderLoans, useLoanInstallments, useLenderLoanDecision, useLenderCreditProfile, useLenderDashboard } from '@/hooks/lender/useLenderData';

type Loan = {
  id: string;
  business_ref: string;
  amount_requested: number;
  amount_approved?: number | null;
  term_days?: number | null;
  status: string;
  score: number;
  credit_band: string | null;
  sub: string;
};

type Tab = 'overview' | 'kyc' | 'schedule';

function pseudonym(ref: string) {
  return `Trader ${ref.slice(-6).toUpperCase()}`;
}

function creditBand(score: number): { band: string; color: string } {
  if (score >= 80) return { band: 'A', color: 'var(--brand)' };
  if (score >= 65) return { band: 'B', color: 'var(--brand)' };
  if (score >= 50) return { band: 'C', color: 'var(--gold-2)' };
  if (score >= 35) return { band: 'D', color: 'var(--gold-2)' };
  return { band: 'E', color: 'var(--danger)' };
}

type RiskTone = 'success' | 'warn' | 'danger' | 'neutral';
function riskTone(score: number): { tone: RiskTone; label: string } {
  if (score >= 65) return { tone: 'success', label: 'Low' };
  if (score >= 50) return { tone: 'warn',    label: 'Medium' };
  return { tone: 'danger', label: 'High' };
}

const CHART_H = 80;

const DOC_LABELS: Record<string, string> = {
  ghana_card_front:       'Ghana Card · Front',
  ghana_card_back:        'Ghana Card · Back',
  business_registration:  'Business Registration',
  tin_certificate:        'TIN Certificate',
  utility_bill:           'Utility Bill',
};

function DetailPanel({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const { data: installments = [], isLoading } = useLoanInstallments(loan.id);
  const decision = useLenderLoanDecision();
  const { data: profile } = useLenderCreditProfile(loan.business_ref);
  const [tab, setTab] = useState<Tab>('overview');
  const [approving, setApproving] = useState(false);
  const [approveAmt, setApproveAmt] = useState(String(loan.amount_requested));
  const [approveRate, setApproveRate] = useState('24');
  const [approveTerm, setApproveTerm] = useState(String(loan.term_days ?? 90));
  const [approveRef, setApproveRef] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const band = loan.credit_band
    ? { band: loan.credit_band, color: creditBand(loan.score).color }
    : creditBand(loan.score);
  const freshnessDays = (profile as Record<string, unknown>)?.kyc_freshness_days as number | undefined ?? null;
  const isFresh = freshnessDays !== null ? freshnessDays <= 30 : false;

  const riskIndicators = profile?.risk_indicators?.map((r) => ({ l: r.label, v: r.value, t: r.tone })) ?? [];
  const chartData = profile?.monthly_revenue ?? [];
  const chartValues = chartData.map((m) => m.amount / 1000);
  const chartMonths = chartData.map((m) => m.month.slice(0, 3));
  const maxRev = Math.max(...chartValues, 1);
  const consentDate = profile?.consent_granted_at
    ? new Date(profile.consent_granted_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const kycProvider = (profile as Record<string, unknown>)?.kyc_provider as string ?? '—';
  const kycReviewedAt = (profile as Record<string, unknown>)?.kyc_reviewed_at
    ? new Date((profile as Record<string, unknown>).kyc_reviewed_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';
  const kycStatusLabel = (profile as Record<string, unknown>)?.kyc_status as string ?? 'unknown';
  const ghanaCardHint = (profile as Record<string, unknown>)?.ghana_card_id_hint as string ?? '—';
  const tinHint = (profile as Record<string, unknown>)?.tin_hint as string ?? '—';
  const bizRegRef = (profile as Record<string, unknown>)?.business_registration_ref as string ?? '—';
  const kycDocuments = (profile as Record<string, unknown>)?.kyc_documents as string[] ?? [];

  return (
    <div style={{
      width: 400, background: 'var(--sf-surface)',
      borderLeft: '1px solid var(--sf-line)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden', flexShrink: 0,
    }}>
      {/* Header */}
      <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--sf-line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span className="sf-pill sf-pill-brand" style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>{loan.id}</span>
          <span style={{
            fontSize: 10.5, color: 'var(--ink-3)',
            display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
              <circle cx="12" cy="7" r="4"/>
            </svg>
            Anonymized
          </span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-3)', display: 'flex', alignItems: 'center' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <div className="sf-display" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.018em', color: 'var(--ink)', marginBottom: 2 }}>
          {pseudonym(loan.business_ref)}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          {loan.status} · lender-safe business ref
        </div>

        {/* Score + Requested tiles */}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ padding: 10, background: 'var(--sf-sunken)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Score · Band
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="sf-display sf-num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>{loan.score}</span>
              <span style={{
                fontSize: 13, fontWeight: 700, color: band.color,
                background: `color-mix(in srgb, ${band.color} 12%, transparent)`,
                padding: '1px 6px', borderRadius: 5,
              }}>{band.band}</span>
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--brand)', fontWeight: 600, marginTop: 2 }}>↑ 38 pts · 3mo</div>
          </div>
          <div style={{ padding: 10, background: 'var(--sf-sunken)', borderRadius: 10 }}>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
              Requested
            </div>
            <div className="sf-display sf-num" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>
              GH₵ {(loan.amount_requested / 1000).toFixed(1)}k
            </div>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', marginTop: 2 }}>
              Proposed term entered at approval
            </div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={{ display: 'flex', gap: 2, marginTop: 14, padding: '3px', background: 'var(--sf-sunken)', borderRadius: 10 }}>
          {(['overview', 'kyc', 'schedule'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                all: 'unset', flex: 1, textAlign: 'center', cursor: 'pointer',
                padding: '6px 0', borderRadius: 8, fontSize: 11.5, fontWeight: 600,
                background: tab === t ? 'var(--sf-surface)' : 'transparent',
                color: tab === t ? 'var(--ink)' : 'var(--ink-3)',
                transition: 'background 0.1s, color 0.1s',
                boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.07)' : 'none',
              }}
            >
              {t === 'overview' ? 'Overview' : t === 'kyc' ? 'KYC' : 'Schedule'}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'overview' && (
          <>
            {/* Risk indicators */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sf-line)' }}>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Risk indicators
              </div>
              {riskIndicators.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', padding: '4px 0' }}>Risk analysis not yet available</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {riskIndicators.map((r) => (
                    <div key={r.l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 0' }}>
                      <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.l}</span>
                      <span className={`sf-pill sf-pill-${r.t === 'neutral' ? 'neutral' : r.t === 'success' ? 'success' : 'warn'}`}>
                        {r.v}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 12-month revenue chart */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--sf-line)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Monthly revenue · 12 mo
                </div>
                <span style={{ fontSize: 11, color: 'var(--brand)', fontWeight: 600 }}>GH₵ {chartValues[chartValues.length - 1]?.toFixed(0) ?? 0}k</span>
              </div>
              {/* Chart */}
              {chartValues.length === 0 ? (
                <div style={{ height: CHART_H, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
                  No revenue data available
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  {/* Y-axis labels */}
                  <div style={{ position: 'absolute', left: 0, top: 0, bottom: 18, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 28 }}>
                    {[maxRev, Math.round(maxRev / 2), 0].map((v) => (
                      <span key={v} style={{ fontSize: 9, color: 'var(--ink-4)', lineHeight: 1 }}>{v}k</span>
                    ))}
                  </div>
                  {/* Bars */}
                  <div style={{ marginLeft: 32 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_H }}>
                      {chartValues.map((v, i) => (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                          <div style={{
                            height: Math.max(4, Math.round((v / maxRev) * CHART_H)),
                            borderRadius: '2px 2px 0 0',
                            background: i === chartValues.length - 1 ? 'var(--brand)' : 'var(--brand-soft-2)',
                          }} />
                        </div>
                      ))}
                    </div>
                    {/* Month labels */}
                    <div style={{ display: 'flex', gap: 3, marginTop: 4 }}>
                      {chartMonths.map((m, i) => (
                        <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 8.5, color: 'var(--ink-4)', fontWeight: 600 }}>
                          {i === 0 || i === chartMonths.length - 1 ? m : i === Math.floor(chartMonths.length / 2) ? m : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Consent */}
            <div style={{ padding: '14px 20px' }}>
              <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                Consent
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                  Granted {consentDate} · revocable · scope: anonymized score factors, 12-month revenue trend
                </span>
              </div>
            </div>
          </>
        )}

        {tab === 'kyc' && (
          <div style={{ padding: '14px 20px' }}>
            {/* Status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: 12, background: 'color-mix(in srgb, var(--brand) 8%, transparent)', borderRadius: 10, border: '1px solid color-mix(in srgb, var(--brand) 20%, transparent)' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                <polyline points="9 12 11 14 15 10"/>
              </svg>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                  {kycStatusLabel === 'verified' || kycStatusLabel === 'approved' ? 'Identity Verified' : kycStatusLabel === 'unknown' ? 'KYC Status Unknown' : `KYC ${kycStatusLabel}`}
                </div>
                <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{kycProvider} · {kycReviewedAt}</div>
              </div>
              <div style={{ flex: 1 }} />
              <span className={`sf-pill ${kycStatusLabel === 'verified' || kycStatusLabel === 'approved' ? 'sf-pill-success' : kycStatusLabel === 'unknown' ? 'sf-pill-neutral' : 'sf-pill-warn'}`} style={{ fontSize: 10.5 }}>
                {kycStatusLabel === 'unknown' ? '—' : kycStatusLabel}
              </span>
            </div>

            {/* Fields */}
            <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Identity data
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {[
                { label: 'Ghana Card', value: ghanaCardHint },
                { label: 'GRA TIN', value: tinHint },
                { label: 'Business Reg.', value: bizRegRef },
              ].map((f) => (
                <div key={f.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', background: 'var(--sf-sunken)', borderRadius: 8 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{f.label}</span>
                  <span className="sf-mono" style={{ fontSize: 11.5, color: 'var(--ink)', fontWeight: 600 }}>{f.value}</span>
                </div>
              ))}
            </div>

            {/* Documents */}
            <div style={{ fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Documents · {kycDocuments.length} submitted
            </div>
            {kycDocuments.length === 0 && (
              <div style={{ padding: '12px 10px', background: 'var(--sf-sunken)', borderRadius: 8, fontSize: 12, color: 'var(--ink-3)', marginBottom: 16 }}>
                No documents on record
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 16 }}>
              {kycDocuments.map((doc) => (
                <div key={doc} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'var(--sf-sunken)', borderRadius: 8 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span style={{ fontSize: 12, color: 'var(--ink-2)' }}>{DOC_LABELS[doc] ?? doc}</span>
                </div>
              ))}
            </div>

            {/* Freshness */}
            {freshnessDays !== null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', borderRadius: 9, background: isFresh ? 'color-mix(in srgb, var(--brand) 8%, transparent)' : 'color-mix(in srgb, var(--gold-2) 12%, transparent)', border: `1px solid ${isFresh ? 'color-mix(in srgb, var(--brand) 20%, transparent)' : 'color-mix(in srgb, var(--gold-2) 25%, transparent)'}` }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={isFresh ? 'var(--brand)' : 'var(--gold-2)'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                </svg>
                <span style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600 }}>
                  {freshnessDays} days since verification · {isFresh ? 'Fresh' : 'Stale'}
                </span>
              </div>
            )}
          </div>
        )}

        {tab === 'schedule' && (
          <div style={{ padding: '14px 20px' }}>
            {isLoading ? (
              <p style={{ fontSize: 13, color: 'var(--ink-3)' }}>Loading schedule…</p>
            ) : installments.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--ink-3)', textAlign: 'center', padding: '32px 0' }}>No installments found.</p>
            ) : (
              <div>
                <div style={{
                  display: 'grid', gridTemplateColumns: '28px 1fr 1fr 80px',
                  gap: 8, padding: '6px 0', borderBottom: '1px solid var(--sf-line)',
                  fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  <span>#</span><span>Due date</span><span>Amount</span><span>Status</span>
                </div>
                {installments.map((inst, i) => (
                  <div key={inst.id} style={{
                    display: 'grid', gridTemplateColumns: '28px 1fr 1fr 80px',
                    gap: 8, padding: '10px 0',
                    borderBottom: i < installments.length - 1 ? '1px solid var(--sf-line)' : 'none',
                    fontSize: 12.5, alignItems: 'center',
                  }}>
                    <span style={{ color: 'var(--ink-4)', fontWeight: 600 }}>{i + 1}</span>
                    <span style={{ color: 'var(--ink-2)' }}>{new Date(inst.due_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    <span className="sf-num" style={{ fontWeight: 600, color: 'var(--ink)' }}>GH₵ {Number(inst.amount).toFixed(2)}</span>
                    <span className={`sf-pill ${inst.status === 'paid' ? 'sf-pill-success' : inst.status === 'overdue' ? 'sf-pill-danger' : 'sf-pill-neutral'}`} style={{ fontSize: 10 }}>
                      {inst.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action footer */}
      {decisionError && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--sf-line)', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', color: 'var(--danger)', fontSize: 12 }}>
          {decisionError}
        </div>
      )}
      {!approving ? (
        <div style={{ padding: 16, borderTop: '1px solid var(--sf-line)', display: 'flex', gap: 8 }}>
          <button
            disabled={decision.isPending}
            onClick={() => {
              setDecisionError(null);
              setShowRejectModal(true);
            }}
            style={{
              flex: 1, padding: '10px', borderRadius: 10,
              border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)',
              color: 'var(--ink-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: decision.isPending ? 0.6 : 1,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-surface)')}
          >
            Decline
          </button>
          <button
            disabled={loan.status !== 'pending_partner'}
            onClick={() => {
              setDecisionError(null);
              setApproving(true);
            }}
            style={{
              flex: 1, padding: '10px', borderRadius: 10,
              border: 'none', background: 'var(--brand)',
              color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              opacity: loan.status !== 'pending_partner' ? 0.5 : 1,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand-2)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--brand)')}
          >
            {loan.status === 'pending_partner' ? 'Approve' : 'Decision locked'}
          </button>
        </div>
      ) : (
        <div style={{ padding: 16, borderTop: '1px solid var(--sf-line)', background: 'var(--sf-sunken)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Approval decision
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
            {[
              { label: 'Amount (GH₵)', val: approveAmt, set: setApproveAmt, type: 'number' },
              { label: 'Rate (%)',      val: approveRate, set: setApproveRate, type: 'number' },
              { label: 'Term (days)', val: approveTerm, set: setApproveTerm, type: 'number' },
              { label: 'Partner ref',   val: approveRef,  set: setApproveRef,  type: 'text' },
            ].map((f) => (
              <div key={f.label}>
                <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, marginBottom: 4 }}>{f.label}</div>
                <input
                  type={f.type}
                  value={f.val}
                  onChange={(e) => f.set(e.target.value)}
                  style={{
                    width: '100%', padding: '7px 9px', borderRadius: 8,
                    border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)',
                    fontSize: 12.5, color: 'var(--ink)', outline: 'none', boxSizing: 'border-box',
                    fontFamily: 'var(--font-mono)',
                  }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={() => setApproving(false)}
              style={{
                flex: 1, padding: '9px', borderRadius: 9,
                border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)',
                color: 'var(--ink-2)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              disabled={decision.isPending}
              onClick={() => {
                setDecisionError(null);
                decision.mutate(
                  {
                    loanId: loan.id,
                    action: 'approve',
                    amount_approved: Number(approveAmt),
                    interest_rate: Number(approveRate),
                    term_days: Number(approveTerm),
                    partner_ref: approveRef || undefined,
                  },
                  {
                    onSuccess: () => {
                      setApproving(false);
                      onClose();
                    },
                    onError: (error) => {
                      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                      setDecisionError(detail ?? 'Approval failed. Check the terms and try again.');
                    },
                  }
                );
              }}
              style={{
                flex: 2, padding: '9px', borderRadius: 9,
                border: 'none', background: 'var(--brand)',
                color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                opacity: decision.isPending ? 0.6 : 1,
              }}
            >
              {decision.isPending ? 'Submitting…' : `Confirm approve · GH₵ ${Number(approveAmt).toLocaleString()}`}
            </button>
          </div>
        </div>
      )}

      {/* Reject modal */}
      {showRejectModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 50,
          background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowRejectModal(false); }}
        >
          <div style={{
            background: 'var(--sf-surface)', borderRadius: 16, padding: 24, width: 380,
            boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', marginBottom: 6 }}>Decline application</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 14 }}>
              Provide a reason for the applicant. This will be visible in their account.
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Insufficient credit history, missing documents…"
              rows={3}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 10, boxSizing: 'border-box',
                border: '1.5px solid var(--sf-line-2)', background: 'var(--sf-bg)',
                fontSize: 13, color: 'var(--ink)', outline: 'none', resize: 'vertical',
                fontFamily: 'var(--font-body)',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                onClick={() => { setShowRejectModal(false); setRejectReason(''); }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 9,
                  border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)',
                  color: 'var(--ink-2)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                disabled={decision.isPending}
                onClick={() => {
                  setDecisionError(null);
                  decision.mutate(
                    { loanId: loan.id, action: 'reject', rejection_reason: rejectReason.trim() || undefined },
                    {
                      onSuccess: () => {
                        setShowRejectModal(false);
                        setRejectReason('');
                        onClose();
                      },
                      onError: (error) => {
                        const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                        setDecisionError(detail ?? 'Decline failed. Try again.');
                        setShowRejectModal(false);
                      },
                    }
                  );
                }}
                style={{
                  flex: 2, padding: '10px', borderRadius: 9,
                  border: 'none', background: 'var(--danger)',
                  color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  opacity: decision.isPending ? 0.6 : 1,
                }}
              >
                {decision.isPending ? 'Declining…' : 'Confirm decline'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 20;

export default function LenderLoans() {
  const [page, setPage] = useState(0);
  const { data: loansRaw, isLoading } = useLenderLoans({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const { data: analytics } = useLenderDashboard();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loans: Loan[] = (Array.isArray(loansRaw) ? loansRaw : []).map((l) => ({
    id: l.id,
    business_ref: String((l as Record<string, unknown>).business_ref ?? ''),
    amount_requested: Number(l.amount_requested),
    amount_approved: (l as Record<string, unknown>).amount_approved != null ? Number((l as Record<string, unknown>).amount_approved) : null,
    term_days: (l as Record<string, unknown>).term_days != null ? Number((l as Record<string, unknown>).term_days) : null,
    status: l.status,
    score: Number((l as Record<string, unknown>).credit_score ?? (l as Record<string, unknown>).score ?? 0),
    credit_band: String((l as Record<string, unknown>).credit_band ?? (l as Record<string, unknown>).band ?? '') || null,
    sub: (l as Record<string, unknown>).requested_at
      ? new Date((l as Record<string, unknown>).requested_at as string).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
      : '—',
  }));

  const selected = loans.find((l) => l.id === selectedId) ?? null;
  const pendingLoans = loans.filter((l) => l.status === 'pending_partner');
  const totalRequested = loans.reduce((s, l) => s + l.amount_requested, 0);

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
            Lending
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Loan requests</div>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {pendingLoans.length} pending · GH₵ {totalRequested.toLocaleString()} total
            </span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Main list */}
        <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Active loans',  v: analytics ? String(analytics.active_loans) : '—',         d: '', c: 'var(--brand)' },
              { l: 'Outstanding',   v: analytics ? `GH₵ ${Number(analytics.total_disbursed).toLocaleString()}` : '—', d: '', c: 'var(--ink)' },
              { l: 'Default rate',  v: analytics && analytics.repayment_rate != null ? `${(100 - analytics.repayment_rate).toFixed(1)}%` : '—', d: '', c: 'var(--brand)' },
              { l: 'Avg ticket',    v: analytics?.avg_ticket ? `GH₵ ${Math.round(analytics.avg_ticket).toLocaleString()}` : '—', d: analytics?.avg_tenor_days ? `${Math.round(analytics.avg_tenor_days / 30)} mo term` : '', c: 'var(--ink-3)' },
            ].map((k) => (
              <div key={k.l} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 12, padding: 12 }}>
                <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{k.l}</div>
                <div className="sf-display sf-num" style={{ fontSize: 20, fontWeight: 600, marginTop: 4, color: 'var(--ink)' }}>{k.v}</div>
                <div style={{ fontSize: 11, color: k.c, marginTop: 1, fontWeight: 600 }}>{k.d}</div>
              </div>
            ))}
          </div>

          {/* Table */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid var(--sf-line)',
              display: 'grid', gridTemplateColumns: '2fr 70px 1fr 1fr 1fr 1fr 40px',
              gap: 10, alignItems: 'center',
              fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <div>Ref · ID</div>
              <div>Band</div>
              <div>Score</div>
              <div>Requested</div>
              <div>Risk</div>
              <div>Submitted</div>
              <div />
            </div>

            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '2fr 70px 1fr 1fr 1fr 1fr 40px',
                    gap: 10, padding: '14px', borderBottom: i < 4 ? '1px solid var(--sf-line)' : 'none', alignItems: 'center',
                  }}>
                    {Array.from({ length: 6 }).map((__, j) => (
                      <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4, width: j === 0 ? '80%' : '60%' }} />
                    ))}
                    <div />
                  </div>
                ))
              : loans.length === 0 ? (
                <div style={{ padding: '40px 14px', textAlign: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
                  No loan applications yet
                </div>
              ) : loans.map((loan, i, a) => {
                  const isSelected = loan.id === selectedId;
                  const risk = riskTone(loan.score);
                  const band = loan.credit_band
                    ? { band: loan.credit_band, color: creditBand(loan.score).color }
                    : creditBand(loan.score);
                  return (
                    <div
                      key={loan.id}
                      onClick={() => setSelectedId(isSelected ? null : loan.id)}
                      style={{
                        padding: '12px 14px',
                        borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                        display: 'grid', gridTemplateColumns: '2fr 70px 1fr 1fr 1fr 1fr 40px',
                        gap: 10, alignItems: 'center',
                        background: isSelected ? 'var(--brand-soft)' : 'transparent',
                        cursor: 'pointer', transition: 'background 0.1s',
                      }}
                      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)'; }}
                      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{pseudonym(loan.business_ref)}</div>
                        <div className="sf-mono" style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{loan.id}</div>
                      </div>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        width: 28, height: 28, borderRadius: 8, fontSize: 13, fontWeight: 700,
                        color: band.color,
                        background: `color-mix(in srgb, ${band.color} 12%, transparent)`,
                      }}>
                        {band.band}
                      </div>
                      <div className="sf-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{loan.score}</div>
                      <div className="sf-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>GH₵ {loan.amount_requested.toLocaleString()}</div>
                      <span className={`sf-pill sf-pill-${risk.tone}`}>{risk.label}</span>
                      <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{loan.sub}</div>
                      <div style={{ textAlign: 'right' }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9 18l6-6-6-6"/>
                        </svg>
                      </div>
                    </div>
                  );
                })
            }
          </div>

          {/* Pagination footer */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginTop: 12, padding: '10px 0',
          }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{
                height: 34, borderRadius: 8,
                border: '1px solid var(--sf-line-2)',
                background: page === 0 ? 'var(--sf-sunken)' : 'var(--sf-surface)',
                color: page === 0 ? 'var(--ink-4)' : 'var(--ink)',
                fontSize: 12.5, fontWeight: 600,
                cursor: page === 0 ? 'not-allowed' : 'pointer',
                padding: '0 14px',
              }}
            >
              ← Previous
            </button>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Page {page + 1} · showing {loans.length} loans
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={loans.length < PAGE_SIZE}
              style={{
                height: 34, borderRadius: 8,
                border: '1px solid var(--sf-line-2)',
                background: loans.length < PAGE_SIZE ? 'var(--sf-sunken)' : 'var(--sf-surface)',
                color: loans.length < PAGE_SIZE ? 'var(--ink-4)' : 'var(--ink)',
                fontSize: 12.5, fontWeight: 600,
                cursor: loans.length < PAGE_SIZE ? 'not-allowed' : 'pointer',
                padding: '0 14px',
              }}
            >
              Next →
            </button>
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <DetailPanel loan={selected} onClose={() => setSelectedId(null)} />
        )}
      </div>
    </div>
  );
}
