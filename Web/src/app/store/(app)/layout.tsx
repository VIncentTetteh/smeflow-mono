import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { StoreNav } from '@/components/store/StoreNav';

export default async function StoreAppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  if (!cookieStore.get('store_token')) redirect('/store/login');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--sf-bg)' }}>
      <StoreNav />
      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minHeight: '100vh',
        }}
      >
        {children}
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
