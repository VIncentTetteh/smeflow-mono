'use client';
import React from 'react';

/** Format an amount as Ghana cedis. */
export function ghs(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return new Intl.NumberFormat('en-GH', {
    style: 'currency',
    currency: 'GHS',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0);
}

export function num(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : (value ?? 0);
  return new Intl.NumberFormat('en-GH').format(Number.isFinite(n) ? n : 0);
}

export function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          padding: '24px 28px 18px',
          borderBottom: '1px solid var(--sf-line)',
          position: 'sticky',
          top: 0,
          background: 'var(--sf-bg)',
          zIndex: 5,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--ink)',
              letterSpacing: '-0.02em',
            }}
          >
            {title}
          </h1>
          {subtitle && (
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 3 }}>{subtitle}</p>
          )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8 }}>{actions}</div>}
      </header>
      <div style={{ padding: '20px 28px 40px' }}>{children}</div>
    </div>
  );
}

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: 'var(--sf-surface)',
        border: '1px solid var(--sf-line)',
        borderRadius: 14,
        padding: 18,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'brand' | 'success' | 'warn' | 'danger';
}) {
  const color =
    tone === 'brand'
      ? 'var(--brand)'
      : tone === 'success'
        ? 'var(--success)'
        : tone === 'warn'
          ? 'var(--warn)'
          : tone === 'danger'
            ? 'var(--danger)'
            : 'var(--ink)';
  return (
    <Card>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 26,
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
      {hint && <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>{hint}</div>}
    </Card>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  type = 'button',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  disabled?: boolean;
  type?: 'button' | 'submit';
}) {
  const styles: React.CSSProperties =
    variant === 'primary'
      ? { background: 'var(--brand)', color: '#fff', border: 'none' }
      : variant === 'danger'
        ? { background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid transparent' }
        : { background: 'transparent', color: 'var(--ink-2)', border: '1px solid var(--sf-line-2)' };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 38,
        padding: '0 16px',
        borderRadius: 10,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...styles,
      }}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: React.ReactNode;
  tone?: 'default' | 'brand' | 'success' | 'warn' | 'danger';
}) {
  const map: Record<string, { bg: string; fg: string }> = {
    default: { bg: 'var(--sf-sunken)', fg: 'var(--ink-2)' },
    brand: { bg: 'var(--brand-soft)', fg: 'var(--brand)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
    warn: { bg: 'var(--warn-soft)', fg: 'var(--warn)' },
    danger: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
  };
  const c = map[tone];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        background: c.bg,
        color: c.fg,
        textTransform: 'capitalize',
      }}
    >
      {children}
    </span>
  );
}

export function PlanGateBanner({ feature, plan }: { feature: string; plan?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 14px',
        borderRadius: 10,
        background: 'var(--warn-soft)',
        marginBottom: 16,
      }}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--warn)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
      </svg>
      <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
        {feature} is a premium feature{plan ? ` — your ${plan} plan may not include it` : ''}. Upgrade
        in Billing to unlock the full experience.
      </span>
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <Card style={{ textAlign: 'center', padding: '40px 20px' }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-2)' }}>{title}</div>
      {hint && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>{hint}</div>}
    </Card>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
      {label ?? 'Loading…'}
    </div>
  );
}

export function Table({ head, rows }: { head: React.ReactNode[]; rows: React.ReactNode[][] }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={i}
              style={{
                textAlign: i === head.length - 1 && h === '' ? 'right' : 'left',
                padding: '11px 16px',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--ink-3)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '1px solid var(--sf-line)',
                background: 'var(--sf-bg)',
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, ri) => (
          <tr key={ri}>
            {r.map((cell, ci) => (
              <td
                key={ci}
                style={{
                  padding: '12px 16px',
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  borderBottom: ri === rows.length - 1 ? 'none' : '1px solid var(--sf-line)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
