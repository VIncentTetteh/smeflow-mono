'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  useStorefrontSettings,
  useUpdateStorefront,
  checkSlug,
} from '@/hooks/store/useStorefrontSettings';
import { useItems, useUpdateItem, useUploadItemImage, type Item } from '@/hooks/store/useStoreInventory';
import { usePlanGate } from '@/hooks/store/usePlanGate';
import { PageShell, Card, Button, Badge, Spinner, EmptyState, PlanGateBanner, ghs } from '@/components/store/kit';
import { Field, TextInput } from '@/components/store/Modal';

export default function StorefrontPage() {
  const { data, isLoading } = useStorefrontSettings();
  const update = useUpdateStorefront();
  const gate = usePlanGate('storefront');

  const [slug, setSlug] = useState('');
  const [tagline, setTagline] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [slugState, setSlugState] = useState<{ checking: boolean; available?: boolean; reason?: string }>({ checking: false });

  useEffect(() => {
    if (data) {
      setSlug(data.slug ?? '');
      setTagline(data.tagline ?? '');
      setWhatsapp(data.whatsapp ?? '');
    }
  }, [data]);

  useEffect(() => {
    if (!slug || slug === data?.slug) {
      setSlugState({ checking: false });
      return;
    }
    setSlugState({ checking: true });
    const t = setTimeout(async () => {
      try {
        const r = await checkSlug(slug);
        setSlugState({ checking: false, available: r.available, reason: r.reason });
        if (r.slug !== slug) setSlug(r.slug);
      } catch {
        setSlugState({ checking: false });
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug, data?.slug]);

  if (isLoading) {
    return (
      <PageShell title="Storefront">
        <Spinner />
      </PageShell>
    );
  }

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const shopUrl = data?.slug ? `${origin}/shop/${data.slug}` : '';

  const save = async () => {
    try {
      await update.mutateAsync({ slug: slug || undefined, tagline, whatsapp });
      toast.success('Storefront saved');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string; error?: { message?: string } } } })?.response?.data;
      toast.error(msg?.detail || msg?.error?.message || 'Could not save');
    }
  };

  const toggleEnabled = async () => {
    try {
      await update.mutateAsync({ enabled: !data?.enabled });
      toast.success(data?.enabled ? 'Storefront turned off' : 'Storefront is live 🎉');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string; error?: { message?: string } } } })?.response?.data;
      toast.error(msg?.detail || msg?.error?.message || 'Could not update');
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(shopUrl);
    toast.success('Link copied');
  };
  const shareWhatsApp = () => {
    const text = encodeURIComponent(`Shop from ${data?.slug} online: ${shopUrl}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <PageShell
      title="Storefront"
      subtitle="A shareable online shop your customers can order and pay from"
      actions={
        <Button variant={data?.enabled ? 'danger' : 'primary'} onClick={toggleEnabled} disabled={update.isPending || (!data?.enabled && !data?.slug)}>
          {data?.enabled ? 'Turn off' : 'Turn on storefront'}
        </Button>
      }
    >
      {!gate.enabled && <PlanGateBanner feature="Online storefront" plan={gate.plan} />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Status
            </span>
            <Badge tone={data?.enabled ? 'success' : 'default'}>{data?.enabled ? 'Live' : 'Off'}</Badge>
          </div>

          <Field label="Shop link">
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              <span style={{ fontSize: 13, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>/shop/</span>
              <TextInput value={slug} onChange={(v) => setSlug(v.toLowerCase())} placeholder="ama-provisions" />
            </div>
          </Field>
          {slug && slug !== data?.slug && (
            <p style={{ fontSize: 12, marginTop: 4, color: slugState.available === false ? 'var(--danger)' : 'var(--ink-3)' }}>
              {slugState.checking ? 'Checking…' : slugState.available === true ? '✓ Available' : slugState.reason || 'Not available'}
            </p>
          )}

          <div style={{ marginTop: 12 }}>
            <Field label="Tagline">
              <TextInput value={tagline} onChange={setTagline} placeholder="Fresh provisions in Makola" />
            </Field>
          </div>
          <div style={{ marginTop: 12 }}>
            <Field label="WhatsApp number (for customers to contact you)">
              <TextInput value={whatsapp} onChange={setWhatsapp} placeholder="+233..." />
            </Field>
          </div>

          <div style={{ marginTop: 16 }}>
            <Button onClick={save} disabled={update.isPending || slugState.available === false}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </Card>

        <Card>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Share your shop
          </span>
          {!data?.slug ? (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 12 }}>
              Set a shop link first, then turn on your storefront to get a shareable URL.
            </p>
          ) : (
            <>
              <div
                style={{
                  marginTop: 12,
                  padding: '12px 14px',
                  borderRadius: 10,
                  background: 'var(--sf-bg)',
                  border: '1px solid var(--sf-line)',
                  fontSize: 13,
                  wordBreak: 'break-all',
                  color: 'var(--ink-2)',
                }}
              >
                {shopUrl}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <Button variant="ghost" onClick={copyLink}>Copy link</Button>
                <Button onClick={shareWhatsApp}>Share on WhatsApp</Button>
              </div>
              {!data?.enabled && (
                <p style={{ fontSize: 12, color: 'var(--warn)', marginTop: 12 }}>
                  Your storefront is off — customers can&apos;t open this link until you turn it on.
                </p>
              )}
              <p style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 12 }}>
                Tip: add photos to your items (Inventory) so they look great in the shop. Paid orders
                appear in Sales automatically.
              </p>
            </>
          )}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <CatalogManager />
      </div>
    </PageShell>
  );
}

function CatalogManager() {
  const { data, isLoading } = useItems();
  const items = data?.items ?? [];
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Catalog — what customers see
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Add photos & choose which items show</span>
      </div>
      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <EmptyState title="No items yet" hint="Add items in Inventory first." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((it) => (
            <CatalogRow key={it.id} item={it} />
          ))}
        </div>
      )}
    </Card>
  );
}

function CatalogRow({ item }: { item: Item }) {
  const upload = useUploadItemImage();
  const updateItem = useUpdateItem();
  const fileRef = useRef<HTMLInputElement>(null);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await upload.mutateAsync({ id: item.id, file });
      toast.success('Photo updated');
    } catch {
      toast.error('Could not upload photo (JPEG/PNG/WebP, max 5 MB)');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const toggleVisible = async () => {
    try {
      await updateItem.mutateAsync({ id: item.id, body: { storefront_visible: !item.storefront_visible } });
    } catch {
      toast.error('Could not update');
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 10px', borderRadius: 10, background: 'var(--sf-bg)' }}>
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: 8,
          background: 'var(--sf-sunken)',
          flexShrink: 0,
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 18,
        }}
      >
        {item.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image_url} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          '🛍️'
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{ghs(item.sell_price)}</div>
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={onPick} style={{ display: 'none' }} />
      <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
        {upload.isPending ? 'Uploading…' : item.image_url ? 'Change photo' : 'Add photo'}
      </Button>
      <button
        onClick={toggleVisible}
        title={item.storefront_visible ? 'Showing in storefront' : 'Hidden from storefront'}
        style={{
          all: 'unset',
          cursor: 'pointer',
          width: 44,
          height: 24,
          borderRadius: 999,
          background: item.storefront_visible ? 'var(--brand)' : 'var(--sf-line-2)',
          position: 'relative',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: item.storefront_visible ? 22 : 2,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: '#fff',
            transition: 'left 0.15s',
          }}
        />
      </button>
    </div>
  );
}
