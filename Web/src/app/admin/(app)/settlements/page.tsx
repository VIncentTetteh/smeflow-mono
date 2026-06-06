'use client';

import { useMemo, useState } from 'react';
import {
  type AdminSettlement,
  useAdminMerchantSettlementBalance,
  useAdminSettlementSummary,
  useAdminSettlements,
  useApproveSettlement,
  useBulkApproveSettlements,
  useCancelAdminSettlement,
  useForceMerchantSettlement,
  useRetryMerchantSettlement,
  useTriggerAutoSettlement,
  useUpdateMerchantSettlementConfig,
} from '@/hooks/admin/useAdminMoney';

function money(value: unknown) {
  const amount = Number(value ?? 0);
  return `GH₵ ${Number.isFinite(amount) ? amount.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}`;
}

function shortDate(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function statusPill(status: string) {
  const s = status.toLowerCase();
  const cls = s === 'completed'
    ? 'sf-pill-success'
    : s === 'processing' || s === 'approved'
      ? 'sf-pill-brand'
      : s === 'pending'
        ? 'sf-pill-warn'
        : s === 'failed' || s === 'cancelled'
          ? 'sf-pill-danger'
          : 'sf-pill-neutral';
  return <span className={`sf-pill ${cls}`} style={{ fontSize: 10.5, textTransform: 'capitalize' }}>{status}</span>;
}

export default function AdminSettlementsPage() {
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<AdminSettlement | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [forceAmount, setForceAmount] = useState('');
  const [threshold, setThreshold] = useState('');
  const summary = useAdminSettlementSummary();
  const settlements = useAdminSettlements(status || undefined);
  const merchantBalance = useAdminMerchantSettlementBalance(selected?.business_id);
  const approve = useApproveSettlement();
  const bulkApprove = useBulkApproveSettlements();
  const cancel = useCancelAdminSettlement();
  const retrySettlement = useRetryMerchantSettlement();
  const trigger = useTriggerAutoSettlement();
  const forceSettle = useForceMerchantSettlement();
  const updateConfig = useUpdateMerchantSettlementConfig();

  const rows = settlements.data?.items ?? [];
  const pendingRows = useMemo(() => rows.filter((s) => s.status === 'pending'), [rows]);
  const visibleSelectedIds = selectedIds.filter((id) => rows.some((row) => row.id === id && row.status === 'pending'));
  const allPendingSelected = pendingRows.length > 0 && pendingRows.every((row) => visibleSelectedIds.includes(row.id));
  const toggleSelected = (row: AdminSettlement) => {
    if (row.status !== 'pending') return;
    setSelectedIds((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]);
  };
  const toggleAllPending = () => {
    setSelectedIds((current) => {
      const pendingIds = pendingRows.map((row) => row.id);
      if (pendingIds.every((id) => current.includes(id))) {
        return current.filter((id) => !pendingIds.includes(id));
      }
      return Array.from(new Set([...current, ...pendingIds]));
    });
  };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 22 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin</div>
          <div className="sf-display" style={{ fontSize: 22, fontWeight: 650, color: 'var(--ink)' }}>Merchant settlements</div>
        </div>
        <button
          onClick={() => trigger.mutate()}
          disabled={trigger.isPending}
          style={{ padding: '9px 14px', borderRadius: 9, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', opacity: trigger.isPending ? 0.6 : 1 }}
        >
          {trigger.isPending ? 'Queueing…' : 'Run auto-settlement'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
        {[
          ['Unsettled liability', money(summary.data?.total_unsettled_liability_ghs)],
          ['Pending approval', `${summary.data?.pending_approval_count ?? 0} · ${money(summary.data?.pending_approval_amount_ghs)}`],
          ['In flight', `${summary.data?.in_flight_count ?? 0} · ${money(summary.data?.in_flight_amount_ghs)}`],
          ['Completed today', `${summary.data?.today_completed_count ?? 0} · ${money(summary.data?.today_completed_volume_ghs)}`],
          ['Fees today', money(summary.data?.today_platform_fees_collected_ghs)],
        ].map(([label, value]) => (
          <div key={label} style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 14 }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
            <div className="sf-display sf-num" style={{ fontSize: 18, fontWeight: 650, marginTop: 6, color: 'var(--ink)' }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) 360px', gap: 16 }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--sf-line)' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Settlement queue</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{pendingRows.length} pending in current view</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                onClick={() => bulkApprove.mutate(visibleSelectedIds)}
                disabled={visibleSelectedIds.length === 0 || bulkApprove.isPending}
                style={{ padding: '7px 10px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: visibleSelectedIds.length ? 'pointer' : 'not-allowed', opacity: visibleSelectedIds.length ? 1 : 0.5 }}
              >
                {bulkApprove.isPending ? 'Approving…' : `Bulk approve ${visibleSelectedIds.length}`}
              </button>
              <select value={status} onChange={(e) => { setStatus(e.target.value); setSelectedIds([]); }} style={{ border: '1px solid var(--sf-line)', borderRadius: 8, padding: '7px 9px', background: 'var(--sf-surface)', color: 'var(--ink)', fontSize: 12 }}>
                <option value="">All statuses</option>
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '34px 1.1fr 120px 105px 92px 150px 170px', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--sf-line)', fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            <button onClick={toggleAllPending} style={{ all: 'unset', cursor: pendingRows.length ? 'pointer' : 'not-allowed', color: 'var(--ink-3)' }}>{allPendingSelected ? '✓' : '□'}</button><div>Merchant</div><div>Amount</div><div>Status</div><div>Mode</div><div>Requested</div><div>Actions</div>
          </div>

          {rows.length === 0 ? (
            <div style={{ padding: 22, color: 'var(--ink-3)', fontSize: 13 }}>No settlements found.</div>
          ) : rows.map((row) => (
            <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '34px 1.1fr 120px 105px 92px 150px 170px', gap: 10, padding: '12px 16px', borderBottom: '1px solid var(--sf-line)', alignItems: 'center', fontSize: 13 }}>
              <button onClick={() => toggleSelected(row)} disabled={row.status !== 'pending'} style={{ all: 'unset', cursor: row.status === 'pending' ? 'pointer' : 'not-allowed', color: row.status === 'pending' ? 'var(--ink)' : 'var(--ink-4)', fontSize: 15 }}>
                {visibleSelectedIds.includes(row.id) ? '✓' : '□'}
              </button>
              <button onClick={() => { setSelected(row); setForceAmount(row.amount); setThreshold(''); }} style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink)', fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.business_name}
              </button>
              <span className="sf-num" style={{ fontWeight: 700 }}>{money(row.net_amount)}</span>
              {statusPill(row.status)}
              <span style={{ color: 'var(--ink-3)', textTransform: 'capitalize' }}>{row.mode}</span>
              <span style={{ color: 'var(--ink-3)' }}>{shortDate(row.requested_at)}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={row.status !== 'pending' || approve.isPending} onClick={() => approve.mutate(row.id)} style={{ padding: '6px 9px', borderRadius: 7, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 11, fontWeight: 700, cursor: row.status === 'pending' ? 'pointer' : 'not-allowed', opacity: row.status === 'pending' ? 1 : 0.45 }}>Approve</button>
                {row.status === 'failed' ? (
                  <button disabled={retrySettlement.isPending} onClick={() => retrySettlement.mutate(row.id)} style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--sf-line)', background: 'var(--sf-surface)', color: 'var(--brand)', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
                ) : (
                  <button disabled={row.status !== 'pending' || cancel.isPending} onClick={() => cancel.mutate({ settlementId: row.id, reason: 'Cancelled by admin' })} style={{ padding: '6px 9px', borderRadius: 7, border: '1px solid var(--sf-line)', background: 'var(--sf-surface)', color: 'var(--danger)', fontSize: 11, fontWeight: 700, cursor: row.status === 'pending' ? 'pointer' : 'not-allowed', opacity: row.status === 'pending' ? 1 : 0.45 }}>Cancel</button>
                )}
              </div>
            </div>
          ))}
        </div>

        <aside style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: 16, alignSelf: 'start' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>Merchant controls</div>
          {!selected ? (
            <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink-3)' }}>Select a settlement to inspect wallet balance, recent ledger, pause/resume, or force-settle.</div>
          ) : (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{selected.business_name}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2 }}>{selected.business_id}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
                <div style={{ background: 'var(--sf-sunken)', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>Unsettled</div>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginTop: 3 }}>{money(merchantBalance.data?.unsettled_balance)}</div>
                </div>
                <div style={{ background: 'var(--sf-sunken)', borderRadius: 10, padding: 10 }}>
                  <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>Total settled</div>
                  <div style={{ fontWeight: 700, color: 'var(--ink)', marginTop: 3 }}>{money(merchantBalance.data?.total_settled)}</div>
                </div>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <button onClick={() => updateConfig.mutate({ businessId: selected.business_id, settlement_enabled: !merchantBalance.data?.settlement_enabled })} disabled={updateConfig.isPending || !merchantBalance.data} style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--sf-line)', background: 'var(--sf-surface)', color: merchantBalance.data?.settlement_enabled ? 'var(--danger)' : 'var(--brand)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                  {merchantBalance.data?.settlement_enabled ? 'Pause' : 'Resume'}
                </button>
                <input value={threshold} onChange={(e) => setThreshold(e.target.value)} placeholder={merchantBalance.data?.settlement_threshold ?? 'Threshold'} style={{ width: 92, border: '1px solid var(--sf-line)', borderRadius: 8, padding: '8px', fontSize: 12 }} />
                <button onClick={() => updateConfig.mutate({ businessId: selected.business_id, settlement_threshold: threshold })} disabled={!threshold || updateConfig.isPending} style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background: 'var(--ink)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: threshold ? 'pointer' : 'not-allowed', opacity: threshold ? 1 : 0.5 }}>Save</button>
              </div>
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <input value={forceAmount} onChange={(e) => setForceAmount(e.target.value)} placeholder="Amount" style={{ flex: 1, border: '1px solid var(--sf-line)', borderRadius: 8, padding: '8px', fontSize: 12 }} />
                <button onClick={() => forceSettle.mutate({ businessId: selected.business_id, amount: forceAmount })} disabled={!forceAmount || forceSettle.isPending} style={{ padding: '8px 10px', borderRadius: 8, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: forceAmount ? 'pointer' : 'not-allowed', opacity: forceAmount ? 1 : 0.5 }}>Force-settle</button>
              </div>
              <div style={{ marginTop: 16, fontSize: 11, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Recent ledger</div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(merchantBalance.data?.recent_ledger ?? []).length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>No ledger entries yet.</div>
                ) : merchantBalance.data?.recent_ledger.map((entry) => (
                  <div key={entry.id} style={{ borderBottom: '1px solid var(--sf-line)', paddingBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 12, color: 'var(--ink)', textTransform: 'capitalize' }}>{entry.type}</span>
                      <span className="sf-num" style={{ fontSize: 12, fontWeight: 700 }}>{money(entry.amount)}</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.description ?? shortDate(entry.created_at)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
