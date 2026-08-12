'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useStoreAuth } from '@/stores/authStore';
import { useRole, type StoreRole } from '@/hooks/store/useRole';
import { BusinessSwitcher } from './BusinessSwitcher';

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  roles: StoreRole[]; // roles allowed to SEE this item
};

const ALL: StoreRole[] = ['owner', 'manager', 'staff'];
const MANAGERS: StoreRole[] = ['owner', 'manager'];
const OWNER: StoreRole[] = ['owner'];

const NAV_ITEMS: NavItem[] = [
  {
    href: '/store/dashboard',
    label: 'Dashboard',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V8" /><path d="M10 20V4" /><path d="M16 20v-9" /><path d="M22 20H2" />
      </svg>
    ),
  },
  {
    href: '/store/inventory',
    label: 'Inventory',
    roles: ALL,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
        <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
      </svg>
    ),
  },
  {
    href: '/store/sales',
    label: 'Sales',
    roles: ALL,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H19v3" /><path d="M3 7.5V18a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-1.5" />
      </svg>
    ),
  },
  {
    href: '/store/customers',
    label: 'Customers',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5" /><path d="M2 20a7 7 0 0 1 14 0" /><path d="M16 4a3.5 3.5 0 0 1 0 7" /><path d="M22 20a7 7 0 0 0-5-6.7" />
      </svg>
    ),
  },
  {
    href: '/store/storefront',
    label: 'Storefront',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9h18l-1.5-5.5a1 1 0 0 0-1-.5H5.5a1 1 0 0 0-1 .5L3 9z" /><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9" /><path d="M9 21v-6h6v6" />
      </svg>
    ),
  },
  {
    href: '/store/expenses',
    label: 'Expenses',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M8 12h8" />
      </svg>
    ),
  },
  {
    href: '/store/analytics',
    label: 'Analytics',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 17 6-6 4 4 8-8" /><path d="M14 7h7v7" />
      </svg>
    ),
  },
  {
    href: '/store/team',
    label: 'Team',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    href: '/store/payroll',
    label: 'Payroll',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><circle cx="7" cy="15" r="1.4" />
      </svg>
    ),
  },
  {
    href: '/store/invoicing',
    label: 'Invoicing',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />
      </svg>
    ),
  },
  {
    href: '/store/tax',
    label: 'Tax',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <line x1="9" y1="15" x2="15" y2="9" /><circle cx="9.5" cy="9.5" r="1.5" /><circle cx="14.5" cy="14.5" r="1.5" /><rect x="3" y="3" width="18" height="18" rx="3" />
      </svg>
    ),
  },
  {
    href: '/store/notifications',
    label: 'Notifications',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    href: '/store/billing',
    label: 'Billing',
    roles: OWNER,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1" y="4" width="22" height="16" rx="2" /><line x1="1" y1="10" x2="23" y2="10" />
      </svg>
    ),
  },
  {
    // Only shown to owners of more than one store — filtered separately below.
    href: '/store/all-stores',
    label: 'All Stores',
    roles: OWNER,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: '/store/settings',
    label: 'Settings',
    roles: MANAGERS,
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
];

export function StoreNav() {
  const pathname = usePathname();
  const router = useRouter();
  const role = useRole();
  const logout = useStoreAuth((s) => s.logout);
  const businesses = useStoreAuth((s) => s.businesses);
  const businessId = useStoreAuth((s) => s.businessId);
  const activeStore = businesses.find((b) => b.business_id === businessId)?.business_name;

  const signOut = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      /* clear client state regardless */
    }
    logout();
    router.push('/store/login');
  };

  const ownsMultipleStores = businesses.filter((b) => b.role === 'owner').length > 1;
  const items = NAV_ITEMS.filter((item) => item.roles.includes(role)).filter(
    (item) => item.href !== '/store/all-stores' || ownsMultipleStores
  );

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18, padding: '0 4px' }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: 'var(--gold)',
            color: '#1a1208',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          S
        </div>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>
            SMEFlow
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--ink-3)',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
            }}
          >
            Store Portal
          </div>
        </div>
      </div>

      {/* Active store switcher */}
      <BusinessSwitcher />

      {/* Nav items */}
      <ul style={{ flex: 1, listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {items.map((item) => {
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
          <div
            style={{
              fontSize: 12,
              color: 'var(--ink-2)',
              textTransform: 'capitalize',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {role}
            {activeStore ? ` · ${activeStore}` : ''}
          </div>
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
