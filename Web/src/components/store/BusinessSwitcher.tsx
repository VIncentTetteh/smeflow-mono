'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { useStoreAuth, type BusinessMembership } from '@/stores/authStore';

/**
 * Active-store picker. A user can belong to many businesses; switching re-issues
 * a business-scoped session and clears the react-query cache so no data leaks
 * across stores.
 */
export function BusinessSwitcher() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const businesses = useStoreAuth((s) => s.businesses);
  const businessId = useStoreAuth((s) => s.businessId);
  const setBusinesses = useStoreAuth((s) => s.setBusinesses);
  const setBusiness = useStoreAuth((s) => s.setBusiness);

  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<BusinessMembership[]>('/auth/businesses')
      .then((res) => {
        if (cancelled) return;
        setBusinesses(res.data);
        // Adopt the server's notion of the current business if we don't have one.
        const current = res.data.find((b) => b.is_current);
        if (current && !businessId) setBusiness(current.business_id, current.role);
      })
      .catch(() => {
        /* nav still renders; switcher just shows the active store */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const active =
    businesses.find((b) => b.business_id === businessId) ??
    businesses.find((b) => b.is_current) ??
    businesses[0];

  const switchTo = async (target: BusinessMembership) => {
    if (target.business_id === (active?.business_id ?? businessId)) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      const resp = await fetch('/api/auth/store/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: target.business_id }),
      });
      if (!resp.ok) return;
      const json = await resp.json();
      setBusiness(target.business_id, json.role ?? target.role);
      // All ['store', ...] data is business-scoped — drop it wholesale.
      queryClient.clear();
      setOpen(false);
      router.refresh();
    } finally {
      setSwitching(false);
    }
  };

  if (!active) return null;

  return (
    <div ref={ref} style={{ position: 'relative', marginBottom: 16 }}>
      <button
        onClick={() => businesses.length > 1 && setOpen((v) => !v)}
        disabled={switching}
        style={{
          all: 'unset',
          boxSizing: 'border-box',
          width: '100%',
          cursor: businesses.length > 1 ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 10px',
          borderRadius: 10,
          background: 'var(--sf-bg)',
          border: '1px solid var(--sf-line)',
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: 7,
            background: 'var(--brand-soft)',
            color: 'var(--brand)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {active.business_name.charAt(0).toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: 'var(--ink)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {switching ? 'Switching…' : active.business_name}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              textTransform: 'capitalize',
            }}
          >
            {active.role} · {active.subscription}
          </div>
        </div>
        {businesses.length > 1 && (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ color: 'var(--ink-3)', flexShrink: 0 }}
          >
            <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
          </svg>
        )}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--sf-surface)',
            border: '1px solid var(--sf-line)',
            borderRadius: 10,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            padding: 4,
            zIndex: 20,
            maxHeight: 260,
            overflowY: 'auto',
          }}
        >
          {businesses.map((b) => {
            const isActive = b.business_id === active.business_id;
            return (
              <button
                key={b.business_id}
                onClick={() => switchTo(b)}
                style={{
                  all: 'unset',
                  boxSizing: 'border-box',
                  width: '100%',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: isActive ? 'var(--brand-soft)' : 'transparent',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: isActive ? 600 : 500,
                      color: isActive ? 'var(--brand)' : 'var(--ink)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {b.business_name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', textTransform: 'capitalize' }}>
                    {b.role}
                  </div>
                </div>
                {isActive && (
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ color: 'var(--brand)' }}
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
