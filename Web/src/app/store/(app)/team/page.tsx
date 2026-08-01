'use client';
import { useState } from 'react';
import {
  useMembers,
  useInviteMember,
  useUpdateMember,
  useRemoveMember,
  type Member,
} from '@/hooks/store/useStoreTeam';
import { useCanManage } from '@/hooks/store/useRole';
import { PageShell, Card, Button, Badge, EmptyState, Spinner, Table } from '@/components/store/kit';
import { Modal, Field, TextInput, Select } from '@/components/store/Modal';

export default function TeamPage() {
  const { data: members, isLoading } = useMembers();
  const invite = useInviteMember();
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const canManage = useCanManage();
  const [showInvite, setShowInvite] = useState(false);

  return (
    <PageShell
      title="Team"
      subtitle="Manage who can access this store"
      actions={canManage ? <Button onClick={() => setShowInvite(true)}>+ Invite member</Button> : undefined}
    >
      {isLoading ? (
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
      )}

      {showInvite && (
        <InviteModal
          saving={invite.isPending}
          onClose={() => setShowInvite(false)}
          onSave={async (body) => {
            await invite.mutateAsync(body);
            setShowInvite(false);
          }}
        />
      )}
    </PageShell>
  );
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
  onClose,
  onSave,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: (body: { phone: string; role: 'staff' | 'manager' }) => void;
}) {
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'staff' | 'manager'>('staff');
  const [error, setError] = useState('');
  return (
    <Modal
      title="Invite team member"
      onClose={onClose}
      onSubmit={() => {
        if (!phone.trim()) {
          setError('Phone number is required.');
          return;
        }
        onSave({ phone: phone.trim(), role });
      }}
      saving={saving}
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
    </Modal>
  );
}
