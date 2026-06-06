import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { LenderNav } from '@/components/lender/LenderNav';

export default async function LenderAppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  if (!cookieStore.get('lender_token')) redirect('/lender/login');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--sf-bg)' }}>
      <LenderNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  );
}
