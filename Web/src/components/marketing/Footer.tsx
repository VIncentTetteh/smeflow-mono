export function Footer() {
  return (
    <footer style={{ borderTop: '1px solid var(--sf-line)', padding: '32px 0' }}>
      <div
        className="sf-container"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              background: 'var(--gold-2)',
              color: 'var(--ink)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            S
          </span>
          <span
            style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--ink-3)' }}
          >
            © {new Date().getFullYear()} SMEflow · Built for Ghana&apos;s SMEs
          </span>
        </div>

        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          {['Privacy', 'Terms', 'Support'].map((label) => (
            <a
              key={label}
              href="#"
              style={{ fontSize: 12.5, color: 'var(--ink-3)', textDecoration: 'none' }}
            >
              {label}
            </a>
          ))}
          <a
            href="/admin/login"
            style={{
              fontSize: 12.5,
              color: 'var(--ink-3)',
              textDecoration: 'none',
              border: '1px solid var(--sf-line)',
              borderRadius: 8,
              padding: '5px 12px',
            }}
          >
            Admin
          </a>
        </div>
      </div>
    </footer>
  );
}
