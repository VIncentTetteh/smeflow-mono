import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Toaster } from 'sonner';
import { AdminNav } from '@/components/admin/AdminNav';

export default async function AdminAppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  if (!cookieStore.get('admin_token')) redirect('/admin/login');

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--sf-bg)' }}>
      <AdminNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </main>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
