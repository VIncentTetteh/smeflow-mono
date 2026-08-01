'use client';
import React from 'react';

export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  saving,
  error,
  submitLabel = 'Save',
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  onSubmit: () => void;
  saving?: boolean;
  error?: string;
  submitLabel?: string;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 460,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--sf-surface)',
          border: '1px solid var(--sf-line)',
          borderRadius: 16,
          padding: 24,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--ink)',
            }}
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            style={{ all: 'unset', cursor: 'pointer', color: 'var(--ink-3)', fontSize: 20, lineHeight: 1 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>

        {error && (
          <div style={{ padding: '9px 12px', borderRadius: 9, background: 'var(--danger-soft)', marginTop: 14 }}>
            <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            onClick={onClose}
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 10,
              border: '1px solid var(--sf-line-2)',
              background: 'transparent',
              color: 'var(--ink-2)',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={saving}
            style={{
              height: 40,
              padding: '0 18px',
              borderRadius: 10,
              border: 'none',
              background: saving ? 'var(--sf-sunken)' : 'var(--brand)',
              color: saving ? 'var(--ink-3)' : '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--ink-3)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      {children}
    </label>
  );
}

const controlStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  height: 42,
  padding: '0 12px',
  borderRadius: 10,
  border: '1.5px solid var(--sf-line-2)',
  background: 'var(--sf-bg)',
  fontSize: 14,
  color: 'var(--ink)',
  outline: 'none',
};

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={controlStyle}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={controlStyle}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
