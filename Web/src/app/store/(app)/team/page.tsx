'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { subDays, startOfYear, formatISO } from 'date-fns';
import {
  useMembers,
  useInviteMember,
  useUpdateMember,
  useRemoveMember,
  type Member,
} from '@/hooks/store/useStoreTeam';
import { useStaffPerformance } from '@/hooks/store/useStaffPerformance';
import { useCanManage } from '@/hooks/store/useRole';
import { switchStore } from '@/lib/switchStore';
import { apiClient } from '@/lib/api';
import { useStoreAuth, type BusinessMembership } from '@/stores/authStore';
import { PageShell, Card, Button, Badge, EmptyState, Spinner, Table, ghs } from '@/components/store/kit';
import { Modal, Field, TextInput, Select } from '@/components/store/Modal';

const isoDate = (d: Date) => formatISO(d, { representation: 'date' });

export default function TeamPage() {
  const { data: members, isLoading } = useMembers();
  const invite = useInviteMember();
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const canManage = useCanManage();
  const [showInvite, setShowInvite] = useState(false);
  const [tab, setTab] = useState<'members' | 'performance'>('members');
  const businesses = useStoreAuth((s) => s.businesses);
  const ownedStores = businesses.filter((b) => b.role === 'owner');
  const setBusiness = useStoreAuth((s) => s.setBusiness);
  const queryClient = useQueryClient();
  const router = useRouter();

  return (
    <PageShell
      title="Team"
      subtitle="Manage who can access this store"
      actions={canManage ? <Button onClick={() => setShowInvite(true)}>+ Invite member</Button> : undefined}
    >
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {(['members', 'performance'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '7px 14px',
              borderRadius: 9,
              fontSize: 12.5,
              fontWeight: 600,
              textTransform: 'capitalize',
              color: tab === t ? '#fff' : 'var(--ink-2)',
              background: tab === t ? 'var(--brand)' : 'var(--sf-sunken)',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'members' ? (
        isLoading ? (
          <Spinner />
        ) : !members || members.length === 0 ? (
          <EmptyState title="No team members yet" />
        ) : (
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Table
              head={['Member', 'Role', 'Status', 'Joined', canManage ? '' : '']}
              rows={members.map((m) => [
                <div key="n">
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{m.user_name ?? 'Unnamed'}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{m.user_phone ?? '—'}</div>
                </div>,
                <Badge key="r" tone={m.role === 'owner' ? 'brand' : 'default'}>
                  {m.role}
                </Badge>,
                <Badge key="s" tone={m.is_active ? 'success' : 'danger'}>
                  {m.is_active ? 'active' : 'inactive'}
                </Badge>,
                new Date(m.joined_at).toLocaleDateString(),
                canManage && m.role !== 'owner' ? (
                  <MemberActions
                    key="a"
                    member={m}
                    onRole={(role) => update.mutate({ id: m.id, body: { role } })}
                    onToggle={() => update.mutate({ id: m.id, body: { is_active: !m.is_active } })}
                    onRemove={() => {
                      if (confirm(`Remove ${m.user_name ?? 'this member'} from the team?`)) remove.mutate(m.id);
                    }}
                  />
                ) : (
                  ''
                ),
              ])}
            />
          </Card>
        )
      ) : (
        <StaffPerformancePanel />
      )}

      {showInvite && (
        <InviteModal
          saving={invite.isPending}
          ownedStores={ownedStores}
          onClose={() => setShowInvite(false)}
          onSave={async (body) => {
            await invite.mutateAsync({ phone: body.phone, role: body.role });
            setShowInvite(false);
          }}
          onSaveMultiStore={async (body) => {
            await inviteAcrossStores(body, { setBusiness, queryClient, router });
            setShowInvite(false);
          }}
        />
      )}
    </PageShell>
  );
}

function StaffPerformancePanel() {
  const [period, setPeriod] = useState<'day' | 'week' | 'year'>('day');
  const today = new Date();
  const from =
    period === 'day' ? today : period === 'week' ? subDays(today, 7) : startOfYear(today);
  const { data, isLoading } = useStaffPerformance(isoDate(from), isoDate(today));

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['day', 'week', 'year'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            style={{
              all: 'unset',
              cursor: 'pointer',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              border: `1.5px solid ${period === p ? 'var(--brand)' : 'var(--sf-line-2)'}`,
              color: period === p ? 'var(--brand)' : 'var(--ink-2)',
              background: period === p ? 'var(--brand-soft)' : 'transparent',
            }}
          >
            {p === 'day' ? 'Today' : p === 'week' ? 'Last 7 days' : 'This year'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Spinner />
      ) : !data || data.length === 0 ? (
        <EmptyState title="No sales recorded in this period" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Staff', 'Sales', 'Revenue']}
            rows={data.map((row) => [
              <div key="n">
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{row.name ?? 'Unnamed'}</div>
                {row.phone && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{row.phone}</div>}
              </div>,
              row.sale_count,
              <span key="rev" style={{ fontWeight: 700, color: 'var(--ink)' }}>
                {ghs(row.revenue)}
              </span>,
            ])}
          />
        </Card>
      )}
    </div>
  );
}

/** Invite the same phone into several owned stores — the invite endpoint is
 * scoped to the session's current business, so each store needs its own
 * switch-then-invite round trip, then we restore the original session. */
async function inviteAcrossStores(
  body: { phone: string; role: 'staff' | 'manager'; storeIds: string[] },
  ctx: Parameters<typeof switchStore>[1]
) {
  const originalBusinessId = useStoreAuth.getState().businessId;

  for (const storeId of body.storeIds) {
    await switchStore(storeId, ctx);
    await apiClient.post('/business/members/invite', { phone: body.phone, role: body.role });
  }
  if (originalBusinessId) {
    await switchStore(originalBusinessId, ctx);
  }
}

function MemberActions({
  member,
  onRole,
  onToggle,
  onRemove,
}: {
  member: Member;
  onRole: (role: string) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
      <select
        value={member.role}
        onChange={(e) => onRole(e.target.value)}
        style={{
          height: 34,
          padding: '0 8px',
          borderRadius: 8,
          border: '1px solid var(--sf-line-2)',
          background: 'var(--sf-surface)',
          fontSize: 12.5,
          color: 'var(--ink)',
        }}
      >
        <option value="staff">staff</option>
        <option value="manager">manager</option>
      </select>
      <Button variant="ghost" onClick={onToggle}>
        {member.is_active ? 'Deactivate' : 'Activate'}
      </Button>
      <Button variant="danger" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}

function InviteModal({
  saving,
  ownedStores,
  onClose,
  onSave,
  onSaveMultiStore,
}: {
  saving: boolean;
  ownedStores: BusinessMembership[];
  onClose: () => void;
  onSave: (body: { phone: string; role: 'staff' | 'manager' }) => void;
  onSaveMultiStore: (body: { phone: string; role: 'staff' | 'manager'; storeIds: string[] }) => void;
}) {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'staff' | 'manager'>('staff');
  const [error, setError] = useState('');
  const [multiStoreSaving, setMultiStoreSaving] = useState(false);
  const [selectedStoreIds, setSelectedStoreIds] = useState<string[]>(
    ownedStores.length > 1 ? [ownedStores.find((b) => b.is_current)?.business_id ?? ''] : []
  );

  const toggleStore = (id: string) =>
    setSelectedStoreIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <Modal
      title="Invite team member"
      onClose={onClose}
      onSubmit={async () => {
        if (!phone.trim()) {
          setError('Phone number is required.');
          return;
        }
        if (ownedStores.length > 1) {
          if (selectedStoreIds.length === 0) {
            setError('Select at least one store to invite this person to.');
            return;
          }
          setMultiStoreSaving(true);
          try {
            await onSaveMultiStore({ phone: phone.trim(), role, storeIds: selectedStoreIds });
          } finally {
            setMultiStoreSaving(false);
          }
          return;
        }
        onSave({ phone: phone.trim(), role });
      }}
      saving={saving || multiStoreSaving}
      error={error}
      submitLabel="Send invite"
    >
      <Field label="Phone number">
        <TextInput value={phone} onChange={setPhone} placeholder="024 000 0000" autoFocus />
      </Field>
      <Field label="Role">
        <Select
          value={role}
          onChange={(v) => setRole(v as 'staff' | 'manager')}
          options={[
            { value: 'staff', label: 'Staff — inventory & sales' },
            { value: 'manager', label: 'Manager — full access' },
          ]}
        />
      </Field>
      {ownedStores.length > 1 && (
        <Field label="Stores to add this person to">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {ownedStores.map((store) => {
              const selected = selectedStoreIds.includes(store.business_id);
              return (
                <button
                  key={store.business_id}
                  type="button"
                  onClick={() => toggleStore(store.business_id)}
                  style={{
                    all: 'unset',
                    cursor: 'pointer',
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    border: `1.5px solid ${selected ? 'var(--brand)' : 'var(--sf-line-2)'}`,
                    color: selected ? 'var(--brand)' : 'var(--ink-2)',
                    background: selected ? 'var(--brand-soft)' : 'transparent',
                  }}
                >
                  {store.business_name}
                </button>
              );
            })}
          </div>
        </Field>
      )}
    </Modal>
  );
}
