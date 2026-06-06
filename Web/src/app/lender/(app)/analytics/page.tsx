'use client';
import { useState } from 'react';
import { useLenderDashboard } from '@/hooks/lender/useLenderData';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid } from 'recharts';

const SECTOR_COLORS = ['var(--brand)', 'var(--gold)', '#6bbf9f', '#a3d4c1', 'var(--sf-line-2)'];

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return isoDate(d);
}

function defaultTo() {
  return isoDate(new Date());
}

export default function LenderAnalytics() {
  const [fromDate, setFromDate] = useState(defaultFrom());
  const [toDate, setToDate] = useState(defaultTo());

  const { data, isLoading, isError, refetch } = useLenderDashboard({
    from_date: fromDate,
    to_date: toDate,
  });

  function handleReset() {
    setFromDate(defaultFrom());
    setToDate(defaultTo());
  }

  const totalDisbursed = data?.total_disbursed ?? 0;
  const repaymentRate = data?.repayment_rate ?? 0;
  const avgTicket = data?.avg_ticket ?? 0;
  const nplRate = data?.npl_rate ?? 0;
  const avgTenor = data?.avg_tenor_days ? Math.round(data.avg_tenor_days / 30) : 0;
  const disbursedChart = data?.monthly_disbursements ?? [];
  const repaidChart = data?.monthly_repaid ?? [];
  const sectorData = data?.portfolio_by_sector ?? [];
  const reviewQueue = data?.review_queue ?? [];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Lender</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Portfolio analytics</div>
        </div>
        <div style={{ flex: 1 }} />

        {/* Date range inputs */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>From</label>
          <input
            type="date"
            value={fromDate}
            max={toDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{
              height: 32, borderRadius: 8, border: '1px solid var(--sf-line-2)',
              background: 'var(--sf-surface)', color: 'var(--ink)',
              fontSize: 12, padding: '0 8px', outline: 'none',
            }}
          />
          <label style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 600 }}>To</label>
          <input
            type="date"
            value={toDate}
            min={fromDate}
            max={isoDate(new Date())}
            onChange={(e) => setToDate(e.target.value)}
            style={{
              height: 32, borderRadius: 8, border: '1px solid var(--sf-line-2)',
              background: 'var(--sf-surface)', color: 'var(--ink)',
              fontSize: 12, padding: '0 8px', outline: 'none',
            }}
          />
          <button
            onClick={handleReset}
            style={{
              all: 'unset', cursor: 'pointer',
              fontSize: 11.5, color: 'var(--brand)', fontWeight: 600,
              padding: '4px 8px', borderRadius: 6,
            }}
          >
            Reset
          </button>
        </div>

        <span className="sf-pill sf-pill-neutral" style={{ fontSize: 11 }}>Live backend data</span>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {isError && (
          <div style={{ background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 22%, transparent)', borderRadius: 12, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, fontSize: 13, color: 'var(--ink)' }}>Analytics could not load from the lender API.</div>
            <button onClick={() => refetch()} style={{ border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)', borderRadius: 8, padding: '7px 10px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Pending review', value: data?.pending_loan_requests ?? 0, sub: `${reviewQueue.length} newest shown`, tone: (data?.pending_loan_requests ?? 0) > 0 ? 'var(--gold-2)' : 'var(--ink)' },
            { label: 'Consented traders', value: data?.consented_businesses ?? 0, sub: 'eligible for review', tone: 'var(--ink)' },
            { label: 'Active products', value: data?.active_products ?? 0, sub: `${data?.total_products ?? 0} total products`, tone: (data?.active_products ?? 0) > 0 ? 'var(--brand)' : 'var(--danger)' },
            { label: 'API status', value: data?.api_ready ? 'Ready' : 'Check', sub: data?.webhook_configured ? 'Webhook configured' : 'No webhook URL', tone: data?.api_ready ? 'var(--brand)' : 'var(--danger)' },
          ].map((item) => (
            <div key={item.label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{item.label}</div>
              <div className="sf-num" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, marginTop: 4, color: item.tone }}>{isLoading ? '—' : item.value}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        {/* KPI strip */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { label: 'Total disbursed',   value: `GH₵ ${Math.round(totalDisbursed).toLocaleString()}`, sub: 'assigned active/repaid loans', danger: false },
            { label: 'Repayment rate',    value: `${repaymentRate}%`, sub: 'paid instalments', danger: repaymentRate < 85 && totalDisbursed > 0 },
            { label: 'NPL rate',          value: `${nplRate}%`, sub: 'defaulted loan count', danger: nplRate > 5 },
            { label: 'Avg ticket size',   value: `GH₵ ${Math.round(avgTicket).toLocaleString()}`, sub: avgTenor > 0 ? `${avgTenor} mo avg tenor` : 'no active tenor', danger: false },
          ].map(({ label, value, sub, danger }) => (
            <div key={label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16 }}>
              <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, marginTop: 4, color: danger ? 'var(--danger)' : 'var(--ink)' }}>{value}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          {/* Disbursement trend */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Monthly disbursements</div>
            {disbursedChart.length === 0 ? (
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                {isLoading ? 'Loading disbursements…' : 'No disbursements yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={disbursedChart} barSize={28}>
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--ink-4)' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--ink-4)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${(Number(v)/1000).toFixed(0)}k`} />
                  <Tooltip
                    cursor={{ fill: 'var(--sf-sunken)' }}
                    contentStyle={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: unknown) => [`GH₵ ${Number(v).toLocaleString()}`, 'Disbursed']}
                  />
                  <Bar dataKey="amount" fill="var(--brand)" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Repayment rate trend */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Repayment rate (%)</div>
            {repaidChart.length === 0 ? (
              <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
                {isLoading ? 'Loading repayments…' : 'No repayment schedule yet'}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={180}>
                <LineChart data={repaidChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--sf-line)" />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: 'var(--ink-4)' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: 'var(--ink-4)' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: unknown) => [`${v}%`, 'Repaid']}
                  />
                  <Line type="monotone" dataKey="rate" stroke="var(--gold)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--gold)', strokeWidth: 0 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Sector breakdown */}
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 16 }}>Sector allocation</div>
          {sectorData.length === 0 ? (
            <div style={{ padding: '26px 0', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              {isLoading ? 'Loading sector allocation…' : 'Sector allocation appears after this lender has disbursed loans'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sectorData.map(({ sector, pct }, i) => (
                <div key={sector} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 100, fontSize: 12, color: 'var(--ink-2)', flexShrink: 0 }}>{sector}</div>
                  <div style={{ flex: 1, height: 8, background: 'var(--sf-sunken)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: SECTOR_COLORS[i] ?? 'var(--sf-line-2)', borderRadius: 4, transition: 'width 0.4s' }} />
                  </div>
                  <div className="sf-num" style={{ width: 36, fontSize: 12, fontWeight: 700, color: 'var(--ink)', textAlign: 'right' }}>{pct}%</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
