'use client';
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { useCommissionRates, useUpdateCommissionRate } from '@/hooks/admin/useAdminPeople';

export default function AdminSettings() {
  const { data: rates = [], isLoading } = useCommissionRates();
  const updateRate = useUpdateCommissionRate();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, boolean>>({});

  const handleSave = (eventType: string, currentRate: string) => {
    const newRate = parseFloat(edits[eventType] ?? currentRate);
    if (isNaN(newRate) || newRate <= 0) return;
    updateRate.mutate({ event_type: eventType, rate: newRate }, {
      onSuccess: () => {
        setSaved((prev) => ({ ...prev, [eventType]: true }));
        setTimeout(() => setSaved((prev) => ({ ...prev, [eventType]: false })), 2000);
      },
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Config</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Settings</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{
          background: 'var(--sf-surface)', border: '1px solid var(--sf-line)',
          borderRadius: 14, overflow: 'hidden', maxWidth: 640,
        }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--sf-line)' }}>
            <div className="sf-display" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Commission rates</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3 }}>
              GH₵ amount agents earn per qualifying event
            </div>
          </div>

          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} style={{ padding: '16px 20px', borderBottom: i < 3 ? '1px solid var(--sf-line)' : 'none', display: 'flex', gap: 16, alignItems: 'center' }}>
                <div style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4, width: 200 }} />
                <div style={{ height: 36, background: 'var(--sf-sunken)', borderRadius: 8, width: 120 }} />
              </div>
            ))
          ) : (
            rates.map((rate, i, a) => (
              <div key={rate.event_type} style={{
                padding: '14px 20px',
                borderBottom: i < a.length - 1 ? '1px solid var(--sf-line)' : 'none',
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', textTransform: 'capitalize' }}>
                    {rate.event_type.replace(/_/g, ' ')}
                  </div>
                  {rate.updated_by && (
                    <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>Last updated by {rate.updated_by}</div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 600 }}>GH₵</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={edits[rate.event_type] ?? rate.rate}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [rate.event_type]: e.target.value }))}
                    style={{ width: 90, height: 36, borderRadius: 8, borderColor: 'var(--sf-line-2)', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 14 }}
                  />
                </div>
                <button
                  disabled={updateRate.isPending}
                  onClick={() => handleSave(rate.event_type, rate.rate)}
                  style={{
                    padding: '7px 14px', borderRadius: 8,
                    border: '1px solid var(--sf-line-2)',
                    background: saved[rate.event_type] ? 'var(--brand-soft)' : 'var(--sf-surface)',
                    color: saved[rate.event_type] ? 'var(--brand)' : updateRate.isPending ? 'var(--ink-4)' : 'var(--ink-2)',
                    fontSize: 12.5, fontWeight: 600, cursor: updateRate.isPending ? 'not-allowed' : 'pointer',
                    minWidth: 60,
                  }}
                >
                  {saved[rate.event_type] ? 'Saved ✓' : 'Save'}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
