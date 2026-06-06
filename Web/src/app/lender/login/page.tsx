'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLenderAuth } from '@/stores/authStore';

export default function LenderLoginPage() {
  const router = useRouter();
  const setAuth = useLenderAuth((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) return;
    setLoading(true); setError('');
    try {
      const resp = await fetch('/api/auth/lender', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const json = await resp.json();
      if (!resp.ok) { setError(json.detail ?? 'Authentication failed. Check your password.'); return; }
      if (json.must_reset_password) {
        sessionStorage.setItem('lender_reset_token', json.reset_token);
        sessionStorage.setItem('lender_reset_email', email.trim());
        router.push('/lender/reset-password');
        return;
      }
      setAuth(json.role ?? 'lender', json.lender_id ?? '');
      router.push('/lender/dashboard');
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div className="sf-login-shell">
      {/* Left brand panel */}
      <div className="sf-login-brand-panel" style={{
        width: 380, background: 'var(--sf-surface)',
        borderRight: '1px solid var(--sf-line)',
        display: 'flex', flexDirection: 'column',
        padding: '48px 40px', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 48 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: 'var(--ink)', color: '#fdf7eb',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 13,
          }}>S</div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>SMEFlow</div>
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '1.5px 7px', borderRadius: 9999,
              background: 'transparent', border: '1px solid var(--sf-line-2)',
              fontSize: 9.5, fontWeight: 600, color: 'var(--ink-2)',
            }}>Lender Portal</span>
          </div>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.025em', lineHeight: 1.2, marginBottom: 12 }}>
          Access your<br/>lending dashboard
        </h1>
        <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 40 }}>
          View consented businesses, manage loan requests, and monitor your portfolio performance.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
          {[
            { n: 'Consented businesses', d: 'See anonymized scores and risk data' },
            { n: 'Loan pipeline', d: 'Review, approve, and track disbursements' },
            { n: 'Portfolio analytics', d: 'Repayment rates, defaults, sector mix' },
          ].map((f) => (
            <div key={f.n} style={{ padding: '12px 14px', borderRadius: 12, background: 'var(--sf-sunken)', border: '1px solid var(--sf-line)' }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{f.n}</div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{f.d}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 28, fontSize: 10.5, color: 'var(--ink-4)' }}>v2026.5 · API /v1</div>
      </div>

      {/* Form panel */}
      <div className="sf-login-form-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 40px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Authenticate
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', marginBottom: 28 }}>
            Enter your portal credentials to continue
          </p>

          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ops@ghanafin.com"
                autoComplete="username"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  border: '1.5px solid var(--sf-line-2)', borderRadius: 12,
                  background: 'var(--sf-surface)', height: 48,
                  padding: '0 14px', fontSize: 13.5, color: 'var(--ink)',
                  outline: 'none',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Password
              </label>
              <div style={{
                display: 'flex', alignItems: 'center',
                border: '1.5px solid var(--sf-line-2)', borderRadius: 12,
                background: 'var(--sf-surface)', overflow: 'hidden',
                height: 48,
              }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Temporary or current password"
                  autoComplete="current-password"
                  style={{ flex: 1, border: 'none', outline: 'none', padding: '0 14px', background: 'transparent', fontSize: 13.5, color: 'var(--ink)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{ all: 'unset', cursor: 'pointer', padding: '0 14px', color: 'var(--ink-3)', display: 'flex', alignItems: 'center' }}
                >
                  {showPassword ? (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 5 }}>
                First-time users must change the temporary password from SMEFlow ops
              </p>
            </div>

            {error && (
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--danger-soft)', border: '1px solid #e8c9c3' }}>
                <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
              </div>
            )}

            <button type="submit" disabled={loading || !email.trim() || !password.trim()} style={{
              marginTop: 4, height: 46, borderRadius: 12, border: 'none',
              background: loading || !email.trim() || !password.trim() ? 'var(--sf-sunken)' : 'var(--ink)',
              color: loading || !email.trim() || !password.trim() ? 'var(--ink-3)' : '#fdf7eb',
              fontSize: 14, fontWeight: 700, cursor: loading || !email.trim() || !password.trim() ? 'not-allowed' : 'pointer',
            }}>
              {loading ? 'Authenticating…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
