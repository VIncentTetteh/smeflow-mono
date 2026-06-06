'use client';
import { useRouter } from 'next/navigation';
import { useAdminAgentHealth, useAdminKpis } from '@/hooks/admin/useAdminData';
import { useKycQueue, useSyncQueue, useMomoSettlements, useAuditLogs, useAdminFraudQueue } from '@/hooks/admin/useAdminQueues';

type RiskLevel = 'low' | 'med' | 'high';

function RiskPill({ level }: { level: RiskLevel }) {
  const map: Record<RiskLevel, { cls: string; label: string }> = {
    low:  { cls: 'sf-pill sf-pill-success', label: 'Low' },
    med:  { cls: 'sf-pill sf-pill-warn',    label: 'Med' },
    high: { cls: 'sf-pill sf-pill-danger',  label: 'High' },
  };
  const { cls, label } = map[level];
  return <span className={cls}>{label}</span>;
}

function StatusPill({ status }: { status: string }) {
  if (status === 'settled' || status === 'verified') return <span className="sf-pill sf-pill-success">{status}</span>;
  if (status === 'syncing') return <span className="sf-pill sf-pill-brand">syncing</span>;
  if (status === 'queued') return <span className="sf-pill sf-pill-neutral">queued</span>;
  if (status === 'pending') return <span className="sf-pill sf-pill-warn">pending</span>;
  if (status === 'failed') return <span className="sf-pill sf-pill-danger">failed</span>;
  return <span className="sf-pill sf-pill-neutral">{status}</span>;
}

function ProviderBadge({ provider }: { provider: string }) {
  const colors: Record<string, { bg: string; text: string }> = {
    MTN:     { bg: '#fff3cd', text: '#856404' },
    Telecel: { bg: '#fde8e8', text: '#c0392b' },
    AT:      { bg: '#dbeafe', text: '#1d4ed8' },
  };
  const c = colors[provider] ?? { bg: 'var(--sf-sunken)', text: 'var(--ink-3)' };
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
      background: c.bg, color: c.text,
    }}>
      {provider}
    </span>
  );
}


export default function AdminDashboard() {
  const router = useRouter();
  const { data: kpis, isLoading: kpisLoading } = useAdminKpis();
  const { data: agentHealthData } = useAdminAgentHealth();
  const { data: queue, isLoading: queueLoading } = useKycQueue();
  const { data: syncData } = useSyncQueue();
  const { data: settlements } = useMomoSettlements();
  const { data: auditData } = useAuditLogs(1);
  const { data: fraudQueue } = useAdminFraudQueue();

  const agentHealth = agentHealthData;
  const maxOnboarded = Math.max(...(agentHealth?.region_breakdown ?? []).map((r) => (r as { onboarded?: number; agents?: number }).onboarded ?? r.agents ?? 1), 1);

  const fraudArr = Array.isArray(fraudQueue) ? fraudQueue : [];
  const displayFraud = fraudArr.map((f) => ({ sig: f.signal, m: f.business_name, d: f.detail, sev: f.severity, business_id: f.business_id }));

  const queueArr = Array.isArray(queue) ? queue : [];
  const syncArr = Array.isArray(syncData) ? syncData : [];
  const settlementsArr = Array.isArray(settlements) ? settlements : [];

  const kpiCards = [
    { label: 'Active merchants', value: kpisLoading ? null : String(kpis?.active_businesses ?? '—'), delta: `${kpis?.total_businesses ?? '—'} total`, tone: 'brand' as const, route: '/admin/businesses' },
    { label: 'TPV · all time',   value: kpisLoading ? null : `GH₵ ${Number(kpis?.tpv_ghs ?? 0).toLocaleString()}`, delta: `${kpis?.total_sales ?? 0} sales`, tone: 'brand' as const, route: '/admin/ops' },
    { label: 'Subscription rev', value: kpisLoading ? null : `GH₵ ${Number(kpis?.subscription_revenue_ghs ?? 0).toLocaleString()}`, delta: '', tone: 'brand' as const, route: '/admin/ops' },
    { label: 'Loan disbursed',   value: kpisLoading ? null : `GH₵ ${Number(kpis?.loan_disbursement_ghs ?? 0).toLocaleString()}`, delta: '', tone: 'brand' as const, route: '/admin/loans' },
    { label: 'Pending KYC',      value: kpisLoading ? null : String(kpis?.pending_kyc ?? '—'), delta: 'oldest 4h', tone: 'gold' as const },
    { label: 'Sync queued',      value: syncData !== undefined ? String(syncArr.length) : '—', delta: syncArr.length ? `${syncArr.filter((s) => s.status === 'failed').length} failed` : '', tone: 'gold' as const },
    { label: 'Active agents',    value: agentHealth ? String(agentHealth.total_active) : '—', delta: '', tone: 'brand' as const, route: '/admin/agents' },
    { label: 'Fraud signals',    value: String(displayFraud.length), delta: `${displayFraud.filter((f) => f.sev === 'high').length} high`, tone: 'danger' as const, route: '/admin/risk' },
  ];

  const displayQueue = queueArr.slice(0, 5).map((item) => {
    const submittedAt = item.submitted_at ? new Date(item.submitted_at) : null;
    const hoursAgo = submittedAt ? Math.round((Date.now() - submittedAt.getTime()) / 3_600_000) : null;
    const submitted = hoursAgo !== null ? (hoursAgo < 1 ? '<1h ago' : `${hoursAgo}h ago`) : '—';
    const risk: RiskLevel = hoursAgo !== null && hoursAgo > 48 ? 'high' : hoursAgo !== null && hoursAgo > 24 ? 'med' : 'low';
    return {
      id: item.business_id,
      n: item.business_name,
      biz: item.business_name,
      loc: '—',
      agent: '—',
      risk,
      submitted,
    };
  });

  const displaySync = syncArr.map((s) => ({
    id: s.id,
    biz: s.business_name,
    sales: s.sales_count,
    amount: s.total_amount,
    queued_at: s.queued_at,
    status: s.status,
  }));

  const displaySettlements = settlementsArr;

  const displayActivity = auditData?.items?.slice(0, 6).map((log) => ({
    t: new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    a: log.actor_email?.split('@')[0] ?? 'Sys',
    action: log.action,
    l: `${log.action} · ${log.resource_type ?? ''} ${log.resource_id ?? ''}`.trim(),
  })) ?? [];

  const kycPipelineStages = [
    { stage: 'Pending',   count: kpisLoading ? null : (kpis?.pending_kyc ?? null),   color: 'var(--ink-3)',  bg: 'var(--sf-sunken)' },
    { stage: 'Reviewing', count: kpisLoading ? null : (kpis?.reviewing_kyc ?? null), color: 'var(--gold-2)', bg: '#fffbec' },
    { stage: 'Verified',  count: kpisLoading ? null : (kpis?.verified_kyc ?? null),  color: 'var(--brand)', bg: 'var(--brand-soft)' },
    { stage: 'Failed',    count: kpisLoading ? null : (kpis?.failed_kyc ?? null),    color: 'var(--danger)', bg: '#fff0f0' },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{
        height: 56, padding: '0 22px',
        borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 16,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Admin
          </div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 8 }}>
            Ops console
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '1px 7px', borderRadius: 999,
              background: '#dcfce7', fontSize: 10, fontWeight: 700,
              color: '#16a34a', letterSpacing: '0.06em',
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#16a34a', display: 'inline-block' }} />
              LIVE
            </span>
          </div>
        </div>
        <div style={{ flex: 1 }} />
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* KPI row — 6 cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          {kpiCards.map((k) => (
            <button key={k.label} onClick={() => k.route && router.push(k.route)} style={{
              background: 'var(--sf-surface)',
              border: '1px solid var(--sf-line)',
              borderRadius: 14, padding: '13px 14px',
              textAlign: 'left',
              cursor: k.route ? 'pointer' : 'default',
            }}>
              <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {k.label}
              </div>
              {k.value === null ? (
                <div style={{ height: 30, marginTop: 4, background: 'var(--sf-sunken)', borderRadius: 6 }} />
              ) : (
                <div className="sf-display sf-num" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 3, color: 'var(--ink)' }}>
                  {k.value}
                </div>
              )}
              <div style={{
                fontSize: 10.5, marginTop: 2, fontWeight: 600,
                color: k.tone === 'brand' ? 'var(--brand)' : k.tone === 'gold' ? 'var(--gold-2)' : 'var(--danger)',
              }}>
                {k.delta}
              </div>
            </button>
          ))}
        </div>

        {/* Row 2 — KYC pipeline + Agent health */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
          {/* KYC pipeline + queue */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            {/* Panel header */}
            <div style={{
              padding: '13px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center',
            }}>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>
                KYC review queue
              </div>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                {queueLoading ? 'Loading…' : `${queueArr.length} pending`}
              </span>
            </div>

            {/* Pipeline stage bar */}
            <div style={{
              padding: '12px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {kycPipelineStages.map((stage, i) => (
                <div key={stage.stage} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    padding: '6px 12px', borderRadius: 8,
                    background: stage.bg, border: `1px solid ${stage.color}30`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 72,
                  }}>
                    {stage.count === null ? (
                      <div style={{ height: 18, width: 32, background: 'var(--sf-sunken)', borderRadius: 4 }} />
                    ) : (
                      <span className="sf-num sf-display" style={{ fontSize: 18, fontWeight: 700, color: stage.color, lineHeight: 1 }}>
                        {stage.count}
                      </span>
                    )}
                    <span style={{ fontSize: 9.5, color: stage.color, fontWeight: 600, letterSpacing: '0.05em', marginTop: 2 }}>
                      {stage.stage.toUpperCase()}
                    </span>
                  </div>
                  {i < kycPipelineStages.length - 1 && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  )}
                </div>
              ))}
            </div>

            {/* Queue column headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '88px 1fr 1fr 68px 68px 56px 20px',
              gap: 10, padding: '8px 16px',
              borderBottom: '1px solid var(--sf-line)',
              fontSize: 10, color: 'var(--ink-4)',
              fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <span>ID</span><span>Merchant</span><span>Location</span>
              <span>Agent</span><span>Risk</span><span>Submitted</span><span />
            </div>

            {!queueLoading && displayQueue.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                No KYC applications in queue
              </div>
            )}
            {displayQueue.map((r, i) => (
              <div
                key={r.id}
                style={{
                  display: 'grid', gridTemplateColumns: '88px 1fr 1fr 68px 68px 56px 20px',
                  gap: 10, padding: '10px 16px',
                  alignItems: 'center',
                  borderBottom: i < displayQueue.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  fontSize: 12.5, cursor: 'pointer', transition: 'background 0.1s',
                }}
                onClick={() => router.push('/admin/kyc')}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{r.id}</span>
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.n}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.biz !== r.n ? r.biz : ''}</div>
                </div>
                <span style={{ color: 'var(--ink-2)', fontSize: 12 }}>{r.loc}</span>
                <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{r.agent}</span>
                <RiskPill level={r.risk} />
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{r.submitted}</span>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 18l6-6-6-6"/>
                </svg>
              </div>
            ))}
          </div>

          {/* Agent network health */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              padding: '13px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="2"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/>
                <circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/>
                <line x1="7" y1="6.5" x2="10" y2="10.5"/><line x1="17" y1="6.5" x2="14" y2="10.5"/>
                <line x1="7" y1="17.5" x2="10" y2="13.5"/><line x1="17" y1="17.5" x2="14" y2="13.5"/>
              </svg>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>Agent network</div>
              <span style={{ fontSize: 10.5, color: 'var(--brand)', fontWeight: 600 }}>{agentHealth?.regions_covered ?? '—'} regions</span>
            </div>

            {/* Mini stats */}
            {!agentHealth ? (
              <div style={{ padding: 24, textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>Loading agent data…</div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, borderBottom: '1px solid var(--sf-line)' }}>
                  {[
                    { label: 'Active agents',  value: agentHealth.total_active, tone: 'brand' },
                    { label: 'New today',       value: agentHealth.new_onboardings_today, tone: 'brand' },
                    { label: 'Commission due',  value: `GH₵ ${agentHealth.commission_due_ghs.toLocaleString()}`, tone: 'gold' },
                    { label: 'Top agent',       value: agentHealth.top_agent.code, tone: 'neutral' },
                  ].map((stat, i) => (
                    <div key={stat.label} style={{
                      padding: '10px 14px',
                      borderRight: i % 2 === 0 ? '1px solid var(--sf-line)' : 'none',
                      borderBottom: i < 2 ? '1px solid var(--sf-line)' : 'none',
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{stat.label}</div>
                      <div className="sf-display sf-num" style={{
                        fontSize: 19, fontWeight: 700, marginTop: 2,
                        color: stat.tone === 'brand' ? 'var(--brand)' : stat.tone === 'gold' ? 'var(--gold-2)' : 'var(--ink)',
                      }}>
                        {stat.value}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Top agent callout */}
                <div style={{
                  margin: '10px 14px', padding: '8px 12px',
                  background: 'var(--brand-soft)', borderRadius: 8,
                  border: '1px solid var(--brand-soft-2)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: '50%',
                    background: 'var(--brand)', color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {agentHealth.top_agent.name.split(' ').map((n) => n[0]).join('')}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>{agentHealth.top_agent.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{agentHealth.top_agent.code} · {agentHealth.top_agent.onboarded} onboarded</div>
                  </div>
                  <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: 'var(--brand)', color: '#fff', fontWeight: 700 }}>TOP</span>
                </div>

                {/* Region breakdown */}
                <div style={{ padding: '0 14px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 }}>Region breakdown</div>
                  {agentHealth.region_breakdown.map((r) => {
                    const regionRow = r as { region: string; agents: number; onboarded?: number };
                    return (
                      <div key={regionRow.region} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{regionRow.region}</span>
                          <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{regionRow.agents}</span> agents · {regionRow.onboarded ?? 0} onboarded
                          </span>
                        </div>
                        <div style={{ height: 4, borderRadius: 2, background: 'var(--sf-sunken)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 2,
                            background: 'var(--brand)',
                            width: `${Math.round(((regionRow.onboarded ?? 0) / maxOnboarded) * 100)}%`,
                          }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Row 3 — Sync queue + MoMo settlement */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          {/* Sync queue */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              padding: '13px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gold-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>Offline sync queue</div>
              <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>auto-refresh 15s</span>
            </div>

            {/* Headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '80px 1fr 56px 90px 72px 80px',
              gap: 10, padding: '7px 16px',
              borderBottom: '1px solid var(--sf-line)',
              fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <span>Ref</span><span>Business</span><span>Sales</span><span>Amount</span><span>Queued</span><span>Status</span>
            </div>

            {displaySync.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                Sync queue is empty
              </div>
            )}
            {displaySync.map((row, i) => (
              <div
                key={row.id}
                style={{
                  display: 'grid', gridTemplateColumns: '80px 1fr 56px 90px 72px 80px',
                  gap: 10, padding: '10px 16px', alignItems: 'center',
                  borderBottom: i < displaySync.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  fontSize: 12.5, cursor: 'pointer', transition: 'background 0.1s',
                }}
                onClick={() => router.push('/admin/audit')}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{row.id}</span>
                <span style={{ fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.biz}</span>
                <span className="sf-num" style={{ color: 'var(--ink-2)', textAlign: 'right' }}>{row.sales}</span>
                <span className="sf-num" style={{ color: 'var(--ink)', fontWeight: 600 }}>GH₵ {row.amount.toLocaleString()}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.queued_at}</span>
                <StatusPill status={row.status} />
              </div>
            ))}
          </div>

          {/* MoMo settlements */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              padding: '13px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="1" y="4" width="22" height="16" rx="2" ry="2"/>
                <line x1="1" y1="10" x2="23" y2="10"/>
              </svg>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>MoMo settlements</div>
              <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>auto-refresh 60s</span>
            </div>

            {/* Headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '80px 72px 96px 64px 100px 76px',
              gap: 10, padding: '7px 16px',
              borderBottom: '1px solid var(--sf-line)',
              fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <span>Ref</span><span>Provider</span><span>Amount</span><span>Bizs</span><span>Settled at</span><span>Status</span>
            </div>

            {displaySettlements.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                No settlements today
              </div>
            )}
            {displaySettlements.map((row, i) => (
              <div
                key={row.ref}
                style={{
                  display: 'grid', gridTemplateColumns: '80px 72px 96px 64px 100px 76px',
                  gap: 10, padding: '10px 16px', alignItems: 'center',
                  borderBottom: i < displaySettlements.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  fontSize: 12.5, cursor: 'pointer', transition: 'background 0.1s',
                }}
                onClick={() => router.push('/admin/audit')}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{row.ref}</span>
                <ProviderBadge provider={row.provider} />
                <span className="sf-num" style={{ fontWeight: 600, color: 'var(--ink)' }}>GH₵ {row.amount.toLocaleString()}</span>
                <span className="sf-num" style={{ color: 'var(--ink-2)' }}>{row.businesses}</span>
                <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{row.settled_at}</span>
                <StatusPill status={row.status} />
              </div>
            ))}
          </div>
        </div>

        {/* Row 4 — Recent activity + Fraud signals */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
          {/* Recent activity */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              padding: '13px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center',
            }}>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>Recent activity</div>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>Audit log</span>
            </div>

            {/* Headers */}
            <div style={{
              display: 'grid', gridTemplateColumns: '44px 80px 1fr',
              gap: 12, padding: '7px 16px',
              borderBottom: '1px solid var(--sf-line)',
              fontSize: 10, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              <span>Time</span><span>Actor</span><span>Event</span>
            </div>

            {displayActivity.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                No recent activity
              </div>
            )}
            {displayActivity.map((r, i) => {
              const actionColor = r.action?.includes('approv') || r.action?.includes('onboard') || r.action?.includes('settlement')
                ? 'var(--brand)' : r.action?.includes('flag') || r.action?.includes('held')
                ? 'var(--danger)' : 'var(--ink-3)';
              return (
                <div
                  key={i}
                  style={{
                    display: 'grid', gridTemplateColumns: '44px 80px 1fr',
                    gap: 12, padding: '9px 16px', alignItems: 'center',
                    borderBottom: i < displayActivity.length - 1 ? '1px solid var(--sf-line)' : 'none',
                    fontSize: 12, transition: 'background 0.1s',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <span className="sf-mono" style={{ color: 'var(--ink-3)', fontSize: 11 }}>{r.t}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: 'var(--sf-sunken)', border: '1px solid var(--sf-line)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 700, color: 'var(--ink-3)',
                    }}>
                      {r.a === 'Sys' ? '⚙' : r.a.slice(0, 2).toUpperCase()}
                    </div>
                    <span style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{r.a}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 3, height: 3, borderRadius: '50%', background: actionColor, flexShrink: 0 }} />
                    <span style={{ color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.l}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Fraud signals */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{
              padding: '13px 16px', borderBottom: '1px solid var(--sf-line)',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div className="sf-display" style={{ fontSize: 14, fontWeight: 600, flex: 1, color: 'var(--ink)' }}>Fraud signals · 24h</div>
              <span style={{ fontSize: 10.5, padding: '2px 8px', borderRadius: 999, background: '#fff0f0', color: 'var(--danger)', fontWeight: 700 }}>
                {displayFraud.length} active
              </span>
            </div>

            {displayFraud.length === 0 && (
              <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12.5, color: 'var(--ink-3)' }}>
                No active fraud signals
              </div>
            )}
            {displayFraud.map((s, i) => (
              <div
                key={s.sig}
                style={{
                  padding: '13px 16px',
                  borderBottom: i < displayFraud.length - 1 ? '1px solid var(--sf-line)' : 'none',
                  display: 'flex', gap: 10, cursor: 'pointer', transition: 'background 0.1s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--sf-sunken)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{
                  width: 4, borderRadius: 2, flexShrink: 0, alignSelf: 'stretch',
                  background: s.sev === 'high' ? 'var(--danger)' : 'var(--gold-2)',
                }} />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{s.sig}</span>
                    <span style={{
                      fontSize: 9.5, padding: '1px 6px', borderRadius: 999, fontWeight: 700,
                      background: s.sev === 'high' ? '#fff0f0' : '#fffbec',
                      color: s.sev === 'high' ? 'var(--danger)' : 'var(--gold-2)',
                    }}>
                      {s.sev.toUpperCase()}
                    </span>
                  </div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-2)', fontWeight: 600 }}>{s.m}</div>
                  <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{s.d}</div>
                </div>
                <button
                  onClick={() => router.push(s.business_id ? `/admin/kyc?business_id=${s.business_id}` : '/admin/kyc')}
                  style={{
                    alignSelf: 'center', padding: '4px 10px', borderRadius: 6,
                    border: '1px solid var(--sf-line)', background: 'transparent',
                    fontSize: 11, color: 'var(--ink-2)', cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  Review
                </button>
              </div>
            ))}

            {/* Summary footer */}
            <div style={{
              padding: '10px 16px', borderTop: '1px solid var(--sf-line)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{displayFraud.filter(f => f.sev === 'high').length} high severity</span>
              <button
                onClick={() => router.push('/admin/risk')}
                style={{
                  padding: '4px 12px', borderRadius: 6,
                  border: '1px solid var(--danger)', background: 'transparent',
                  fontSize: 11, color: 'var(--danger)', cursor: 'pointer', fontWeight: 600,
                }}
              >
                View all signals
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
