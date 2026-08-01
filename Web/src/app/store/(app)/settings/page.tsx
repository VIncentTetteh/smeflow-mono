'use client';
import { useEffect, useState } from 'react';
import {
  useBusiness,
  useUpdateBusiness,
  useMe,
  useUpdateMe,
} from '@/hooks/store/useStoreBusiness';
import { useCanManage } from '@/hooks/store/useRole';
import { PageShell, Card, Button, Badge, Spinner } from '@/components/store/kit';
import { Field, TextInput } from '@/components/store/Modal';
import { toast } from 'sonner';

export default function SettingsPage() {
  const canManage = useCanManage();
  return (
    <PageShell title="Settings" subtitle="Business profile and your account">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <BusinessCard canManage={canManage} />
        <ProfileCard />
      </div>
    </PageShell>
  );
}

function BusinessCard({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useBusiness();
  const update = useUpdateBusiness();

  const [name, setName] = useState('');
  const [tin, setTin] = useState('');
  const [address, setAddress] = useState('');
  const [region, setRegion] = useState('');
  const [city, setCity] = useState('');

  useEffect(() => {
    if (data) {
      setName(data.name ?? '');
      setTin(data.tin ?? '');
      setAddress(data.address ?? '');
      setRegion(data.region ?? '');
      setCity(data.city ?? '');
    }
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }
  if (!data) return null;

  const save = async () => {
    try {
      await update.mutateAsync({ name, tin, address, region, city });
      toast.success('Business profile updated');
    } catch {
      toast.error('Could not update business profile');
    }
  };

  return (
    <Card>
      <CardTitle>Business profile</CardTitle>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Badge tone="brand">{data.subscription}</Badge>
        <Badge>{data.type}</Badge>
        <Badge tone={data.is_active ? 'success' : 'danger'}>{data.is_active ? 'active' : 'suspended'}</Badge>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Business name">
          <TextInput value={name} onChange={setName} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="TIN">
            <TextInput value={tin} onChange={setTin} />
          </Field>
          <Field label="Region">
            <TextInput value={region} onChange={setRegion} />
          </Field>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="City">
            <TextInput value={city} onChange={setCity} />
          </Field>
          <Field label="Address">
            <TextInput value={address} onChange={setAddress} />
          </Field>
        </div>
      </div>

      {data.dva_account_number && (
        <div style={{ marginTop: 14, padding: '10px 12px', borderRadius: 10, background: 'var(--sf-bg)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            Settlement account
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink)' }}>
            {data.dva_account_name} · {data.dva_account_number} ({data.dva_bank_name})
          </div>
        </div>
      )}

      {canManage ? (
        <div style={{ marginTop: 16 }}>
          <Button onClick={save} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 14 }}>
          Only managers and owners can edit the business profile.
        </p>
      )}
    </Card>
  );
}

function ProfileCard() {
  const { data, isLoading } = useMe();
  const update = useUpdateMe();
  const [name, setName] = useState('');

  useEffect(() => {
    if (data) setName(data.name ?? '');
  }, [data]);

  if (isLoading) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }
  if (!data) return null;

  const save = async () => {
    try {
      await update.mutateAsync({ name });
      toast.success('Profile updated');
    } catch {
      toast.error('Could not update profile');
    }
  };

  const kycTone = data.kyc_status === 'verified' ? 'success' : data.kyc_status === 'rejected' ? 'danger' : 'warn';

  return (
    <Card>
      <CardTitle>Your account</CardTitle>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <Badge tone={kycTone}>KYC: {data.kyc_status}</Badge>
        {data.google_linked && <Badge>Google linked</Badge>}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Name">
          <TextInput value={name} onChange={setName} />
        </Field>
        <Field label="Phone">
          <TextInput value={data.phone} onChange={() => {}} />
        </Field>
        {data.email && (
          <Field label="Email">
            <TextInput value={data.email} onChange={() => {}} />
          </Field>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <Button onClick={save} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </Card>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 700,
        color: 'var(--ink-3)',
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}
