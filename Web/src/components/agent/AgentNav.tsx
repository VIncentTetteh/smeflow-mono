'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAgentAuth } from '@/stores/authStore';

const NAV_ITEMS = [
  {
    href: '/agent/dashboard',
    label: 'Dashboard',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V8"/><path d="M10 20V4"/><path d="M16 20v-9"/><path d="M22 20H2"/>
      </svg>
    ),
  },
  {
    href: '/agent/onboarding',
    label: 'Onboard business',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    ),
  },
  {
    href: '/agent/traders',
    label: 'My traders',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4a3.5 3.5 0 0 1 0 7"/><path d="M22 20a7 7 0 0 0-5-6.7"/>
      </svg>
    ),
  },
  {
    href: '/agent/commissions',
    label: 'My commissions',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1.5"/>
      </svg>
    ),
  },
];

export function AgentNav() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAgentAuth((s) => s.logout);

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* clear client state regardless */
    }
    logout();
    router.push('/agent/login');
  };

  return (
    <nav
      style={{
        width: 200,
        minHeight: '100vh',
        background: 'var(--sf-surface)',
        borderRight: '1px solid var(--sf-line)',
        display: 'flex',
        flexDirection: 'column',
        padding: '18px 12px',
        flexShrink: 0,
      }}
    >
      {/* Brand mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 24, padding: '0 4px' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'var(--gold)', color: '#1a1208',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
        }}>A</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>SMEFlow</div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Agent Portal</div>
        </div>
      </div>

      {/* Nav items */}
      <ul style={{ flex: 1, listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: isActive ? 'var(--brand-soft)' : 'transparent',
                  color: isActive ? 'var(--brand)' : 'var(--ink-2)',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: 'none',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <span style={{ color: isActive ? 'var(--brand)' : 'var(--ink-3)' }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Identity + sign out */}
      <div style={{ borderTop: '1px solid var(--sf-line)', paddingTop: 10, marginTop: 4 }}>
        <div style={{ padding: '0 4px 8px' }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: 'var(--ink-3)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Signed in
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>Agent</div>
        </div>
        <button
          onClick={signOut}
          style={{
            all: 'unset',
            boxSizing: 'border-box',
            width: '100%',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            padding: '9px 12px',
            borderRadius: 10,
            border: '1px solid var(--sf-line-2)',
            color: 'var(--ink-2)',
            fontSize: 13,
            fontWeight: 600,
            transition: 'background 0.12s, color 0.12s, border-color 0.12s',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--sf-sunken)';
            e.currentTarget.style.color = 'var(--danger)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--ink-2)';
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sign out
        </button>
      </div>
    </nav>
  );
}
