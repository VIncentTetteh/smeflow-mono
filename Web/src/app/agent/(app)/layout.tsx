import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AgentNav } from '@/components/agent/AgentNav';

export default async function AgentAppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  if (!cookieStore.get('agent_token')) redirect('/agent/login');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--sf-bg)' }}>
      <AgentNav />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minHeight: '100vh' }}>
        {children}
      </main>
    </div>
  );
}
