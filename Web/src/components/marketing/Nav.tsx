'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const LINKS = [
  { href: '#features', label: 'Features' },
  { href: '#pricing', label: 'Pricing' },
  { href: '#faq', label: 'FAQ' },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 40,
        borderBottom: '1px solid var(--sf-line)',
        background: scrolled ? 'var(--sf-bg)' : 'transparent',
        backdropFilter: scrolled ? 'blur(8px)' : 'none',
        transition: 'background 0.2s ease',
      }}
    >
      <nav
        className="sf-container"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 64 }}
      >
        <Link href="#" style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none' }}>
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--gold-2)',
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            S
          </span>
          <span
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 16, color: 'var(--ink)' }}
          >
            SMEflow
          </span>
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div className="sf-nav-links" style={{ display: 'flex', gap: 24 }}>
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--ink-3)', textDecoration: 'none' }}
              >
                {l.label}
              </a>
            ))}
          </div>
          <a
            href="#pricing"
            style={{
              height: 36,
              padding: '0 16px',
              borderRadius: 8,
              background: 'var(--ink)',
              color: '#f5efe1',
              display: 'flex',
              alignItems: 'center',
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Get the app
          </a>
        </div>
      </nav>

      <style>{`
        @media (max-width: 700px) {
          .sf-nav-links { display: none !important; }
        }
      `}</style>
    </header>
  );
}
