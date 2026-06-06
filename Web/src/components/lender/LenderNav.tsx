'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useLenderAuth } from '@/stores/authStore';
import { useLenderBusinesses, useLenderLoans, useLenderProfile, useLenderDashboard } from '@/hooks/lender/useLenderData';

const NAV_ITEMS = [
  {
    href: '/lender/dashboard',
    label: 'Portfolio',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V8"/><path d="M10 20V4"/><path d="M16 20v-9"/><path d="M22 20H2"/>
      </svg>
    ),
  },
  {
    href: '/lender/businesses',
    label: 'Consented businesses',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16"/><path d="M15 9h4a1 1 0 0 1 1 1v11"/><path d="M8 9h3M8 13h3M8 17h3M18 13h.1M18 17h.1"/>
      </svg>
    ),
  },
  {
    href: '/lender/loans',
    label: 'Loan requests',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 8h16v10H4z"/><circle cx="12" cy="13" r="2.5"/><path d="M7 10v6M17 10v6"/>
      </svg>
    ),
  },
  {
    href: '/lender/products',
    label: 'Products',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
        <line x1="12" y1="22.08" x2="12" y2="12"/>
      </svg>
    ),
  },
  {
    href: '/lender/revenue',
    label: 'Revenue',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19V5"/><path d="M4 19h16"/><path d="m7 15 4-4 3 3 6-7"/><path d="M16 7h4v4"/>
      </svg>
    ),
  },
  {
    href: '/lender/analytics',
    label: 'Analytics',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 17 6-6 4 4 8-8"/><path d="M14 7h7v7"/>
      </svg>
    ),
  },
  {
    href: '/lender/settings',
    label: 'API access',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>
      </svg>
    ),
  },
];

export function LenderNav() {
  const pathname = usePathname();
  const router = useRouter();
  const logout = useLenderAuth((s) => s.logout);
  const { data: profile } = useLenderProfile();
  const { data: businesses } = useLenderBusinesses();
  const { data: loans } = useLenderLoans();
  const { data: analytics } = useLenderDashboard();
  const pendingCount = analytics?.pending_loan_requests ?? 0;
  const counts: Record<string, number | undefined> = {
    '/lender/businesses': businesses?.total,
    '/lender/loans': Array.isArray(loans) ? loans.filter((loan) => loan.status === 'pending_partner').length : undefined,
  };
  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
    logout();
    router.push('/lender/login');
  };

  return (
    <nav
      style={{
        width: 220,
        minHeight: '100vh',
        background: 'var(--sf-surface)',
        borderRight: '1px solid var(--sf-line)',
        display: 'flex',
        flexDirection: 'column',
        padding: '12px',
        flexShrink: 0,
      }}
    >
      {/* Brand mark */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '4px 8px' }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'var(--ink)', color: '#fdf7eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
        }}>S</div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>SMEFlow</div>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '1.5px 7px', borderRadius: 9999,
            background: 'transparent', border: '1px solid var(--sf-line-2)',
            fontSize: 10, fontWeight: 600, color: 'var(--ink-2)',
          }}>Lender Portal · {profile?.name ?? 'Partner'}</div>
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
                  background: isActive ? 'var(--sf-sunken)' : 'transparent',
                  color: isActive ? 'var(--ink)' : 'var(--ink-2)',
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: 'none',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)';
                }}
                onMouseLeave={(e) => {
                  if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent';
                }}
              >
                <span style={{ position: 'relative', color: isActive ? 'var(--ink)' : 'var(--ink-3)', display: 'flex', alignItems: 'center' }}>
                  {item.icon}
                  {item.href === '/lender/loans' && pendingCount > 0 && (
                    <span style={{
                      position: 'absolute', top: -5, right: -5,
                      minWidth: 12, height: 12, borderRadius: 999,
                      background: 'var(--danger)', color: '#fff',
                      fontSize: 8, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 2px',
                    }}>
                      {pendingCount <= 9 ? pendingCount : '9+'}
                    </span>
                  )}
                </span>
                <span style={{ flex: 1 }}>{item.label}</span>
                {counts[item.href] !== undefined && (
                  <span style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 600 }}>{counts[item.href]}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Footer */}
      <div style={{ padding: '8px 8px', fontSize: 10, color: 'var(--ink-4)' }}>
        v2026.5 · API /v1
        <button
          onClick={handleLogout}
          style={{
            all: 'unset', cursor: 'pointer',
            display: 'block', marginTop: 4,
            fontSize: 11, color: 'var(--ink-3)',
            transition: 'color 0.12s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-3)')}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
