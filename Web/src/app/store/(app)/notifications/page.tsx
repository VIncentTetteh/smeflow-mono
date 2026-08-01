'use client';
import { useState } from 'react';
import {
  useAlerts,
  useMarkAlertRead,
  useDismissAlert,
  usePreferences,
  useUpdatePreferences,
} from '@/hooks/store/useStoreNotifications';
import { PageShell, Card, Badge, Button, EmptyState, Spinner } from '@/components/store/kit';
import { toast } from 'sonner';

type Tab = 'attention' | 'history';

export default function NotificationsPage() {
  const [tab, setTab] = useState<Tab>('attention');
  const { data, isLoading } = useAlerts(tab);
  const markRead = useMarkAlertRead();
  const dismiss = useDismissAlert();

  const alerts = data?.items ?? [];

  return (
    <PageShell title="Notifications" subtitle={data ? `${data.unread_count} unread` : undefined}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)', gap: 16 }}>
        <div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
            {(
              [
                ['attention', 'Needs attention'],
                ['history', 'History'],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  padding: '7px 14px',
                  borderRadius: 9,
                  fontSize: 13,
                  fontWeight: 600,
                  color: tab === key ? 'var(--brand)' : 'var(--ink-3)',
                  background: tab === key ? 'var(--brand-soft)' : 'transparent',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {isLoading ? (
            <Spinner />
          ) : alerts.length === 0 ? (
            <EmptyState title="Nothing here" hint={tab === 'attention' ? 'No alerts need your attention.' : 'No past alerts.'} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {alerts.map((a) => (
                <Card key={a.id}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{a.title}</span>
                        <Badge tone={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warn' : 'default'}>
                          {a.severity}
                        </Badge>
                        {!a.read_at && <Badge tone="brand">new</Badge>}
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{a.message}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
                        {new Date(a.created_at).toLocaleString()}
                        {a.occurrence_count > 1 ? ` · ×${a.occurrence_count}` : ''}
                      </div>
                    </div>
                    {tab === 'attention' && (
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {!a.read_at && (
                          <Button variant="ghost" onClick={() => markRead.mutate(a.id)}>
                            Mark read
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            const reason = prompt('Dismiss reason:');
                            if (reason && reason.length >= 3) dismiss.mutate({ id: a.id, reason });
                          }}
                        >
                          Dismiss
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        <PreferencesCard />
      </div>
    </PageShell>
  );
}

function PreferencesCard() {
  const { data, isLoading } = usePreferences();
  const update = useUpdatePreferences();

  return (
    <Card style={{ alignSelf: 'flex-start' }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 14 }}>
        Delivery preferences
      </div>
      {isLoading || !data ? (
        <Spinner />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Toggle
            label="WhatsApp"
            checked={data.whatsapp_enabled}
            onChange={(v) =>
              update.mutate({ whatsapp_enabled: v }, { onSuccess: () => toast.success('Preferences updated') })
            }
          />
          <Toggle
            label="SMS"
            checked={data.sms_enabled}
            onChange={(v) => update.mutate({ sms_enabled: v }, { onSuccess: () => toast.success('Preferences updated') })}
          />
          <Toggle
            label="Push"
            checked={data.push_enabled}
            onChange={(v) => update.mutate({ push_enabled: v }, { onSuccess: () => toast.success('Preferences updated') })}
          />
        </div>
      )}
    </Card>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{label}</span>
      <button
        onClick={() => onChange(!checked)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: 40,
          height: 23,
          borderRadius: 999,
          background: checked ? 'var(--brand)' : 'var(--sf-line-2)',
          position: 'relative',
          transition: 'background 0.15s',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 19 : 2,
            width: 19,
            height: 19,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  );
}
