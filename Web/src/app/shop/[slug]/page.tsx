import type { Metadata } from 'next';
import { getRequiredApiUrl } from '@/lib/serverConfig';
import { StorefrontClient, type Shop } from './StorefrontClient';

async function fetchShop(slug: string): Promise<Shop | null> {
  try {
    const res = await fetch(`${getRequiredApiUrl()}/api/v1/public/shop/${encodeURIComponent(slug)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Shop;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const shop = await fetchShop(slug);
  if (!shop) return { title: 'Shop not found · SMEflow' };
  const title = `${shop.name} · Order online`;
  const description = shop.tagline || `Browse and order from ${shop.name} — pay with MoMo or card.`;
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary', title, description },
  };
}

export default async function ShopPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const shop = await fetchShop(slug);

  if (!shop) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#faf7f0',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🛒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#1a1208' }}>Shop not available</h1>
          <p style={{ color: '#6b6455', marginTop: 6 }}>
            This shop link doesn&apos;t exist or the store is closed.
          </p>
        </div>
      </div>
    );
  }

  return <StorefrontClient shop={shop} slug={slug} />;
}
