'use client';
import { use, useEffect, useState } from 'react';

interface OrderStatus {
  status: 'pending' | 'paid' | 'failed';
  total: number;
  reference: string | null;
}

const C = { bg: '#faf7f0', ink: '#1a1208', muted: '#6b6455', brand: '#0f7b4f' };

export default function OrderStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const paymentId =
      typeof window !== 'undefined' ? sessionStorage.getItem(`sf_order_${slug}`) : null;
    if (!paymentId) {
      setNotFound(true);
      return;
    }
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/public/shop/order/${paymentId}`);
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = (await res.json()) as OrderStatus;
        if (stop) return;
        setOrder(data);
        if (data.status === 'pending') setTimeout(poll, 3000);
      } catch {
        if (!stop) setTimeout(poll, 4000);
      }
    };
    poll();
    return () => {
      stop = true;
    };
  }, [slug]);

  const wrap = (children: React.ReactNode) => (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
      <div style={{ maxWidth: 380 }}>{children}</div>
    </div>
  );

  if (notFound) {
    return wrap(
      <>
        <div style={{ fontSize: 40 }}>🧾</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Order not found</h1>
        <a href={`/shop/${slug}`} style={{ color: C.brand, marginTop: 12, display: 'inline-block' }}>Back to shop</a>
      </>
    );
  }
  if (!order || order.status === 'pending') {
    return wrap(
      <>
        <div style={{ fontSize: 40 }}>⏳</div>
        <h1 style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Confirming your payment…</h1>
        <p style={{ color: C.muted, marginTop: 6 }}>This takes a few seconds. Please keep this page open.</p>
      </>
    );
  }
  if (order.status === 'paid') {
    return wrap(
      <>
        <div style={{ fontSize: 48 }}>✅</div>
        <h1 style={{ fontSize: 22, fontWeight: 800, marginTop: 8 }}>Payment received!</h1>
        <p style={{ color: C.muted, marginTop: 6 }}>
          Show this confirmation at the shop to collect your order.
        </p>
        {order.reference && (
          <p style={{ fontFamily: 'monospace', fontSize: 12, color: C.muted, marginTop: 10 }}>Ref: {order.reference}</p>
        )}
        <a href={`/shop/${slug}`} style={{ color: C.brand, marginTop: 16, display: 'inline-block', fontWeight: 700 }}>Shop again</a>
      </>
    );
  }
  return wrap(
    <>
      <div style={{ fontSize: 44 }}>⚠️</div>
      <h1 style={{ fontSize: 20, fontWeight: 800, marginTop: 8 }}>Payment not completed</h1>
      <p style={{ color: C.muted, marginTop: 6 }}>You were not charged. You can try again.</p>
      <a href={`/shop/${slug}`} style={{ color: C.brand, marginTop: 14, display: 'inline-block', fontWeight: 700 }}>Back to shop</a>
    </>
  );
}
