'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { switchStore } from '@/lib/switchStore';
import { useStoreAuth } from '@/stores/authStore';
import { PageShell, Card, Spinner, EmptyState, ghs } from '@/components/store/kit';

interface StoreSummary {
  business_id: string;
  business_name: string;
  subscription: string;
  today_sales: number;
  staff_count: number;
}

export default function AllStoresPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const setBusiness = useStoreAuth((s) => s.setBusiness);
  const [stores, setStores] = useState<StoreSummary[] | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<StoreSummary[]>('/business/my-stores')
      .then((res) => {
        if (!cancelled) setStores(res.data);
      })
      .catch(() => {
        if (!cancelled) setStores([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const openStore = async (store: StoreSummary) => {
    setSwitchingId(store.business_id);
    try {
      const ok = await switchStore(store.business_id, { setBusiness, queryClient, router });
      if (ok) router.push('/store/dashboard');
    } finally {
      setSwitchingId(null);
    }
  };

  return (
    <PageShell title="All Stores" subtitle="Every store you own, at a glance">
      {stores === null ? (
        <Spinner />
      ) : stores.length === 0 ? (
        <EmptyState title="No stores found" hint="You don't own any stores yet." />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
          }}
        >
          {stores.map((store) => (
            <button
              key={store.business_id}
              onClick={() => openStore(store)}
              disabled={switchingId !== null}
              style={{
                all: 'unset',
                cursor: switchingId ? 'wait' : 'pointer',
                opacity: switchingId && switchingId !== store.business_id ? 0.5 : 1,
              }}
            >
              <Card>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 10,
                  }}
                >
                  <span
                    style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 16,
                      fontWeight: 700,
                      color: 'var(--ink)',
                    }}
                  >
                    {switchingId === store.business_id ? 'Opening…' : store.business_name}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: 'var(--ink-3)',
                      textTransform: 'capitalize',
                    }}
                  >
                    {store.subscription}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                      Today
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>
                      {ghs(store.today_sales)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10.5, color: 'var(--ink-3)', textTransform: 'uppercase' }}>
                      Staff
                    </div>
                    <div style={{ fontWeight: 700, color: 'var(--ink)', marginTop: 2 }}>
                      {store.staff_count}
                    </div>
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </PageShell>
  );
}
