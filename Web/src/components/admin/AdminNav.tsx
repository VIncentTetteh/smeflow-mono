'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAdminAuth } from '@/stores/authStore';
import { useKycQueue } from '@/hooks/admin/useAdminQueues';

const NAV_ITEMS = [
  {
    href: '/admin/dashboard',
    label: 'Overview',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V8"/><path d="M10 20V4"/><path d="M16 20v-9"/><path d="M22 20H2"/>
      </svg>
    ),
  },
  {
    href: '/admin/kyc',
    label: 'KYC review',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 4 6v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>
      </svg>
    ),
  },
  {
    href: '/admin/businesses',
    label: 'Merchants',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 9h3M8 13h3M8 17h3M18 13h.1M18 17h.1"/>
      </svg>
    ),
  },
  {
    href: '/admin/agents',
    label: 'Field agents',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><path d="M16 4a3.5 3.5 0 0 1 0 7"/><path d="M22 20a7 7 0 0 0-5-6.7"/>
      </svg>
    ),
  },
  {
    href: '/admin/loans',
    label: 'Lender pipeline',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h16v10H4z"/><circle cx="12" cy="13" r="2.5"/><path d="M7 10v6M17 10v6"/>
      </svg>
    ),
  },
  {
    href: '/admin/lenders',
    label: 'Lenders',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1.5"/><circle cx="17" cy="14" r="1.2" fill="currentColor"/>
      </svg>
    ),
  },
  {
    href: '/admin/settlements',
    label: 'Settlements',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h10"/><path d="m17 15 2 2 3-4"/>
      </svg>
    ),
  },
  {
    href: '/admin/payouts',
    label: 'Payouts',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3"/><path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1.5"/><path d="m14 13 2 2 4-4"/>
      </svg>
    ),
  },
  {
    href: '/admin/lender-revenue',
    label: 'Lender revenue',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 3 6-7"/><path d="M16 7h4v4"/>
      </svg>
    ),
  },
  {
    href: '/admin/audit',
    label: 'Audit log',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 3h8l4 4v14H6V3Z"/><path d="M14 3v4h4M9 13h6M9 17h6"/>
      </svg>
    ),
  },
  {
    href: '/admin/risk',
    label: 'Risk ops',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3 3 7v5c0 5 3.8 8.5 9 10 5.2-1.5 9-5 9-10V7l-9-4Z"/><path d="M12 8v5"/><path d="M12 17h.01"/>
      </svg>
    ),
  },
  {
    href: '/admin/ops',
    label: 'Ops queues',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/><path d="M8 3v4"/><path d="M16 10v4"/><path d="M11 17v4"/>
      </svg>
    ),
  },
  {
    href: '/admin/settings',
    label: 'Settings',
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>
      </svg>
    ),
  },
];

export function AdminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useAdminAuth((s) => s.logout);
  const { data: kycQueue } = useKycQueue();
  const kycCount = Array.isArray(kycQueue) ? kycQueue.filter((k) => k.status === 'pending').length : 0;

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    logout();
    router.push('/admin/login');
  };

  return (
    <nav
      style={{
        width: 220,
        height: '100vh',
        overflowY: 'auto',
        background: '#13100c',
        color: '#f5efe1',
        display: 'flex',
        flexDirection: 'column',
        padding: '18px 14px',
        flexShrink: 0,
      }}
    >
      {/* Brand mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 28 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: 'var(--gold-2)', color: '#1a1612',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
        }}>S</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600 }}>SMEFlow</div>
          <div style={{ fontSize: 9.5, opacity: 0.45, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin · Ops</div>
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
                  background: isActive ? 'rgba(245,239,225,0.1)' : 'transparent',
                  color: isActive ? '#f5efe1' : 'rgba(245,239,225,0.55)',
                  fontSize: 12.5,
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: 'none',
                  transition: 'background 0.12s, color 0.12s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(245,239,225,0.06)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <span style={{ color: isActive ? '#f5efe1' : 'rgba(245,239,225,0.45)' }}>{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.href === '/admin/kyc' && kycCount > 0 && (
                  <span style={{
                    background: 'var(--gold-2)', color: '#1a1612',
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 9,
                  }}>{kycCount}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* User footer */}
      <div style={{ marginTop: 16, padding: 10, borderRadius: 10, background: 'rgba(245,239,225,0.06)' }}>
        <div style={{ fontSize: 9.5, opacity: 0.45, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 2 }}>Signed in</div>
        <div style={{ fontSize: 12, fontWeight: 600 }}>Admin</div>
        <button
          onClick={handleLogout}
          style={{
            all: 'unset', cursor: 'pointer',
            fontSize: 10.5, color: 'rgba(245,239,225,0.4)',
            marginTop: 4, display: 'block',
            transition: 'color 0.12s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(245,239,225,0.8)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(245,239,225,0.4)')}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
