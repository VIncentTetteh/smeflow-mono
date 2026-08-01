'use client';
import { useMemo, useState } from 'react';

export interface ShopItem {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  price: number;
  image_url: string | null;
  in_stock: boolean;
}
export interface Shop {
  slug: string;
  name: string;
  tagline: string | null;
  whatsapp: string | null;
  region: string | null;
  city: string | null;
  currency: string;
  items: ShopItem[];
}

const C = {
  bg: '#faf7f0',
  surface: '#ffffff',
  ink: '#1a1208',
  muted: '#6b6455',
  line: '#e7e0d2',
  brand: '#0f7b4f',
  brandInk: '#ffffff',
};

function ghs(n: number) {
  return `GH₵${n.toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function StorefrontClient({ shop, slug }: { shop: Shop; slug: string }) {
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState('');

  const items = useMemo(() => Object.fromEntries(shop.items.map((i) => [i.id, i])), [shop.items]);
  const cartLines = Object.entries(cart).filter(([, q]) => q > 0);
  const count = cartLines.reduce((s, [, q]) => s + q, 0);
  const total = cartLines.reduce((s, [id, q]) => s + (items[id]?.price ?? 0) * q, 0);

  const setQty = (id: string, q: number) =>
    setCart((c) => ({ ...c, [id]: Math.max(0, q) }));

  const checkout = async () => {
    if (!phone.trim()) {
      setError('Enter your phone number so the shop can reach you.');
      return;
    }
    if (cartLines.length === 0) return;
    setCheckingOut(true);
    setError('');
    try {
      const resp = await fetch(`/api/public/shop/${slug}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cartLines.map(([id, q]) => ({ item_id: id, qty: q })),
          customer_name: name.trim() || undefined,
          customer_phone: phone.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok || !data.payment_url) {
        setError(data.detail || data?.error?.message || 'Could not start checkout. Please try again.');
        return;
      }
      sessionStorage.setItem(`sf_order_${slug}`, data.payment_id);
      window.location.href = data.payment_url;
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.ink, paddingBottom: count > 0 ? 88 : 24 }}>
      {/* Header */}
      <header style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '20px 16px' }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em' }}>{shop.name}</h1>
          {shop.tagline && <p style={{ color: C.muted, marginTop: 4, fontSize: 14 }}>{shop.tagline}</p>}
          <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 12.5, color: C.muted }}>
            {(shop.city || shop.region) && <span>📍 {[shop.city, shop.region].filter(Boolean).join(', ')}</span>}
            {shop.whatsapp && (
              <a href={`https://wa.me/${shop.whatsapp.replace(/\D/g, '')}`} style={{ color: C.brand, textDecoration: 'none' }}>
                💬 WhatsApp
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Catalog */}
      <main style={{ maxWidth: 760, margin: '0 auto', padding: 16 }}>
        {shop.items.length === 0 ? (
          <p style={{ color: C.muted, textAlign: 'center', padding: 40 }}>No items available right now.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {shop.items.map((it) => {
              const qty = cart[it.id] ?? 0;
              return (
                <div
                  key={it.id}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.line}`,
                    borderRadius: 14,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    opacity: it.in_stock ? 1 : 0.55,
                  }}
                >
                  <div style={{ aspectRatio: '1 / 1', background: '#f1ece0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {it.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.image_url} alt={it.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    ) : (
                      <span style={{ fontSize: 34 }}>🛍️</span>
                    )}
                  </div>
                  <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25 }}>{it.name}</div>
                    {it.description && (
                      <div style={{ fontSize: 11.5, color: C.muted, lineHeight: 1.3, maxHeight: 30, overflow: 'hidden' }}>{it.description}</div>
                    )}
                    <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 14 }}>{ghs(it.price)}</span>
                      {!it.in_stock ? (
                        <span style={{ fontSize: 10.5, color: C.muted }}>Sold out</span>
                      ) : qty === 0 ? (
                        <button onClick={() => setQty(it.id, 1)} style={addBtn}>Add</button>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button onClick={() => setQty(it.id, qty - 1)} style={stepBtn}>−</button>
                          <span style={{ fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{qty}</span>
                          <button onClick={() => setQty(it.id, qty + 1)} style={stepBtn}>+</button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p style={{ textAlign: 'center', color: C.muted, fontSize: 11, marginTop: 24 }}>
          Powered by SMEflow · Pay securely with MoMo or card
        </p>
      </main>

      {/* Cart bar */}
      {count > 0 && !cartOpen && (
        <button onClick={() => setCartOpen(true)} style={cartBar}>
          <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 999, padding: '2px 9px', fontWeight: 700 }}>{count}</span>
          <span style={{ flex: 1, textAlign: 'left', marginLeft: 10 }}>View cart</span>
          <span style={{ fontWeight: 800 }}>{ghs(total)}</span>
        </button>
      )}

      {/* Cart / checkout sheet */}
      {cartOpen && (
        <div onClick={() => setCartOpen(false)} style={sheetOverlay}>
          <div onClick={(e) => e.stopPropagation()} style={sheet}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: 18, fontWeight: 800 }}>Your order</h2>
              <button onClick={() => setCartOpen(false)} style={{ all: 'unset', cursor: 'pointer', fontSize: 22, color: C.muted }}>×</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: '32vh', overflowY: 'auto' }}>
              {cartLines.map(([id, q]) => {
                const it = items[id];
                if (!it) return null;
                return (
                  <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{it.name}</div>
                      <div style={{ fontSize: 12, color: C.muted }}>{ghs(it.price)} × {q}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => setQty(id, q - 1)} style={stepBtn}>−</button>
                      <span style={{ fontWeight: 700, minWidth: 14, textAlign: 'center' }}>{q}</span>
                      <button onClick={() => setQty(id, q + 1)} style={stepBtn}>+</button>
                    </div>
                    <div style={{ width: 70, textAlign: 'right', fontWeight: 700, fontSize: 13 }}>{ghs(it.price * q)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}`, margin: '12px 0', fontWeight: 800 }}>
              <span>Total</span>
              <span>{ghs(total)}</span>
            </div>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" style={field} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number *" inputMode="tel" style={{ ...field, marginTop: 8 }} />
            {error && <p style={{ color: '#c0392b', fontSize: 12.5, marginTop: 8 }}>{error}</p>}
            <button onClick={checkout} disabled={checkingOut || cartLines.length === 0} style={payBtn}>
              {checkingOut ? 'Starting checkout…' : `Pay ${ghs(total)} with MoMo / Card`}
            </button>
            <p style={{ textAlign: 'center', color: C.muted, fontSize: 11, marginTop: 8 }}>Pickup at the shop after payment.</p>
          </div>
        </div>
      )}
    </div>
  );
}

const addBtn: React.CSSProperties = { all: 'unset', cursor: 'pointer', background: C.brand, color: C.brandInk, fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8 };
const stepBtn: React.CSSProperties = { all: 'unset', cursor: 'pointer', width: 26, height: 26, borderRadius: 7, border: `1px solid ${C.line}`, textAlign: 'center', lineHeight: '24px', fontWeight: 700, color: C.ink };
const cartBar: React.CSSProperties = { position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', width: 'min(92%, 720px)', height: 54, background: C.brand, color: C.brandInk, border: 'none', borderRadius: 14, display: 'flex', alignItems: 'center', padding: '0 16px', fontSize: 15, cursor: 'pointer', boxShadow: '0 8px 24px rgba(15,123,79,0.3)' };
const sheetOverlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 50 };
const sheet: React.CSSProperties = { width: '100%', maxWidth: 760, background: C.surface, borderRadius: '18px 18px 0 0', padding: 16, maxHeight: '85vh', overflowY: 'auto' };
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', height: 46, padding: '0 14px', borderRadius: 11, border: `1.5px solid ${C.line}`, fontSize: 15, background: C.bg, color: C.ink, outline: 'none' };
const payBtn: React.CSSProperties = { width: '100%', height: 50, marginTop: 12, background: C.brand, color: C.brandInk, border: 'none', borderRadius: 12, fontSize: 15.5, fontWeight: 800, cursor: 'pointer' };
