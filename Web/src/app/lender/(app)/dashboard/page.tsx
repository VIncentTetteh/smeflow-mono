'use client';
import Link from 'next/link';
import { useLenderDashboard, useLenderProfile } from '@/hooks/lender/useLenderData';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';


export default function LenderDashboard() {
  const { data: analytics, isLoading, isError, refetch } = useLenderDashboard();
  const { data: profile } = useLenderProfile();
  const disbursements = Array.isArray(analytics?.monthly_disbursements) ? analytics!.monthly_disbursements : [];
  const sectorRows = Array.isArray(analytics?.portfolio_by_sector)
    ? analytics!.portfolio_by_sector.map((s) => ({
        sector: s.sector,
        pct: s.pct,
        amount: `GH₵ ${(s.amount / 1000).toFixed(0)}k`,
      }))
    : [];
  const healthRows = Array.isArray(analytics?.repayment_health) ? analytics!.repayment_health : [];

  const kpiCards = [
    {
      label: 'Needs review',
      value: isLoading ? null : String(analytics?.pending_loan_requests ?? 0),
      delta: (analytics?.pending_loan_requests ?? 0) > 0 ? 'Loan decisions waiting' : 'No pending loans',
      tone: (analytics?.pending_loan_requests ?? 0) > 0 ? 'danger' : 'success',
    },
    {
      label: 'Consented traders',
      value: isLoading ? null : String(analytics?.consented_businesses ?? 0),
      delta: 'Eligible profile access',
      tone: 'ink',
    },
    {
      label: 'Product readiness',
      value: isLoading ? null : `${analytics?.active_products ?? 0}/${analytics?.total_products ?? 0}`,
      delta: (analytics?.active_products ?? 0) > 0 ? 'Products active' : 'Create a loan product',
      tone: (analytics?.active_products ?? 0) > 0 ? 'success' : 'danger',
    },
    {
      label: 'Overdue',
      value: isLoading ? null : String(analytics?.overdue_count ?? 0),
      delta: analytics?.overdue_count != null ? (analytics.overdue_count > 0 ? 'Action needed' : 'Up to date') : '',
      tone: (analytics?.overdue_count ?? 0) > 0 ? 'danger' : 'success',
    },
  ];
  const actionCards = [
    {
      title: 'Review loan requests',
      text: `${analytics?.pending_loan_requests ?? 0} pending applications are visible for lender decision.`,
      href: '/lender/loans',
      cta: 'Open queue',
    },
    {
      title: 'Create products',
      text: `${analytics?.active_products ?? 0} active products determine the offers merchants can request.`,
      href: '/lender/products',
      cta: 'Manage products',
    },
    {
      title: 'Check API access',
      text: analytics?.webhook_configured ? 'Webhook URL is configured for status callbacks.' : 'Add a webhook URL for repayment and loan status events.',
      href: '/lender/settings',
      cta: 'API settings',
    },
  ];

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
            {profile?.name ?? 'Lender'} · Portfolio
          </div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
            Portfolio overview
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <span className={analytics?.api_ready ? 'sf-pill sf-pill-success' : 'sf-pill sf-pill-warn'} style={{ gap: 6 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill={analytics?.api_ready ? 'var(--brand)' : 'var(--warn)'}><circle cx="5" cy="5" r="5"/></svg>
          {analytics?.api_ready ? 'API ready' : 'API setup needed'}
        </span>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        {/* First-run onboarding banner */}
        {!isLoading && (analytics?.active_products === 0) && (
          <div style={{
            marginBottom: 18,
            background: 'color-mix(in srgb, var(--brand) 6%, var(--sf-surface))',
            border: '1px solid color-mix(in srgb, var(--brand) 22%, transparent)',
            borderLeft: '4px solid var(--brand)',
            borderRadius: 12, padding: '18px 20px',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>
              Get started with SMEFlow Lender
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ink-2)', marginBottom: 14 }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--brand)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>1</span>
                Create a loan product
              </span>
              <span style={{ color: 'var(--sf-line-2)' }}>→</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'color-mix(in srgb, var(--brand) 20%, transparent)', color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>2</span>
                Share your lender ID
              </span>
              <span style={{ color: 'var(--sf-line-2)' }}>→</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'color-mix(in srgb, var(--brand) 20%, transparent)', color: 'var(--brand)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700, flexShrink: 0 }}>3</span>
                Review loan requests
              </span>
            </div>
            <Link href="/lender/products" style={{ textDecoration: 'none' }}>
              <button style={{
                height: 34, borderRadius: 8, border: 'none',
                background: 'var(--brand)', color: '#fff',
                fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                padding: '0 16px',
              }}>
                Create your first product
              </button>
            </Link>
          </div>
        )}

        {isError && (
          <div style={{ marginBottom: 14, background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 22%, transparent)', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>Could not load lender analytics from the backend.</div>
            <button onClick={() => refetch()} style={{ border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 18 }}>
          {actionCards.map((card) => (
            <Link key={card.href} href={card.href} style={{ textDecoration: 'none', color: 'inherit' }}>
              <div style={{ height: '100%', background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 15 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginBottom: 5 }}>{card.title}</div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45, minHeight: 34 }}>{card.text}</div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--brand)', fontWeight: 700 }}>{card.cta}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* KPI row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
          {kpiCards.map((k) => (
            <div key={k.label} style={{
              background: 'var(--sf-surface)',
              border: '1px solid var(--sf-line)',
              borderRadius: 14, padding: 14,
            }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {k.label}
              </div>
              {k.value === null ? (
                <div style={{ height: 36, marginTop: 4, background: 'var(--sf-sunken)', borderRadius: 6 }} />
              ) : (
                <div className="sf-display sf-num" style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 2, color: 'var(--ink)' }}>
                  {k.value}
                </div>
              )}
              <div style={{
                fontSize: 11, marginTop: 2, fontWeight: 600,
                color: k.tone === 'brand' ? 'var(--brand)'
                  : k.tone === 'success' ? 'var(--brand)'
                  : k.tone === 'danger' ? 'var(--danger)'
                  : 'var(--ink-3)',
              }}>
                {k.delta}
              </div>
            </div>
          ))}
        </div>

        {/* Monthly disbursements chart */}
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden', marginBottom: 14 }}>
          <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--sf-line)', display: 'flex', alignItems: 'center' }}>
            <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>
              Monthly disbursements
            </div>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>12-month rolling</span>
          </div>
          <div style={{ padding: '16px 18px 12px' }}>
            {disbursements.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--ink-3)' }}>
                {isLoading ? 'Loading…' : 'No disbursement data yet'}
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={disbursements} barSize={16}>
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'var(--ink-3)', fontFamily: 'var(--font-body)' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => `₵${(Number(v) / 1000).toFixed(0)}k`}
                  tick={{ fontSize: 10, fill: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  formatter={(v) => [`GH₵ ${Number(v).toLocaleString()}`, 'Disbursed']}
                  contentStyle={{
                    background: 'var(--sf-surface)', border: '1px solid var(--sf-line)',
                    borderRadius: 10, fontSize: 12, boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
                  }}
                  cursor={{ fill: 'var(--sf-sunken)' }}
                />
                <Bar dataKey="amount" fill="var(--brand)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Summary row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Top sectors */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--sf-line)' }}>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Portfolio by sector</div>
            </div>
            {sectorRows.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                {isLoading ? 'Loading…' : 'No portfolio data yet'}
              </div>
            )}
            {sectorRows.map((s, i, a) => (
              <div key={s.sector} style={{
                padding: '10px 16px',
                borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12 }}>
                  <span style={{ fontWeight: 500, color: 'var(--ink-2)' }}>{s.sector}</span>
                  <span className="sf-num" style={{ color: 'var(--ink-3)', fontWeight: 600 }}>{s.pct}% · {s.amount}</span>
                </div>
                <div style={{ height: 4, background: 'var(--sf-sunken)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${s.pct}%`, height: '100%', background: 'var(--brand)', borderRadius: 999 }} />
                </div>
              </div>
            ))}
          </div>

          {/* Repayment health */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: '13px 16px', borderBottom: '1px solid var(--sf-line)' }}>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Repayment health</div>
            </div>
            {healthRows.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                {isLoading ? 'Loading…' : 'No repayment data yet'}
              </div>
            )}
            {healthRows.map((r, i, a) => (
              <div key={r.label} style={{
                padding: '11px 16px',
                borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                <div style={{ width: 4, height: 32, borderRadius: 2, background: r.tone === 'brand' ? 'var(--brand)' : r.tone === 'gold' ? 'var(--gold)' : r.tone === 'warn' ? 'var(--warn)' : 'var(--danger)', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-2)' }}>{r.label}</span>
                    <span className="sf-num" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink)' }}>{r.pct}%</span>
                  </div>
                  <div style={{ height: 4, background: 'var(--sf-sunken)', borderRadius: 999, overflow: 'hidden' }}>
                    <div style={{
                      width: `${r.pct}%`, height: '100%', borderRadius: 999,
                      background: r.tone === 'brand' ? 'var(--brand)' : r.tone === 'gold' ? 'var(--gold)' : r.tone === 'warn' ? 'var(--warn)' : 'var(--danger)',
                    }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
