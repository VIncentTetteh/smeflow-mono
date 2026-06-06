'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLenderAuth } from '@/stores/authStore';

export default function LenderResetPasswordPage() {
  const router = useRouter();
  const setAuth = useLenderAuth((s) => s.setAuth);
  const [resetToken, setResetToken] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('lender_reset_token') ?? '';
    setResetToken(token);
    setEmail(sessionStorage.getItem('lender_reset_email') ?? '');
    if (!token) router.replace('/lender/login');
  }, [router]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      const resp = await fetch('/api/auth/lender/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reset_token: resetToken, new_password: password }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setError(json.detail ?? 'Password reset failed. Sign in again to get a new reset token.');
        return;
      }
      sessionStorage.removeItem('lender_reset_token');
      sessionStorage.removeItem('lender_reset_email');
      setAuth(json.role ?? 'lender', json.lender_id ?? '');
      router.push('/lender/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sf-bg)', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 420, background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 16, padding: 28 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
            Lender Portal
          </div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}>
            Set your password
          </h1>
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {email ? `Finish setup for ${email}.` : 'Finish setup before opening the lender dashboard.'}
          </p>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--sf-line-2)', borderRadius: 12, background: 'var(--sf-surface)', height: 48, padding: '0 14px', fontSize: 13.5, color: 'var(--ink)', outline: 'none' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Confirm password
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              style={{ width: '100%', boxSizing: 'border-box', border: '1.5px solid var(--sf-line-2)', borderRadius: 12, background: 'var(--sf-surface)', height: 48, padding: '0 14px', fontSize: 13.5, color: 'var(--ink)', outline: 'none' }}
            />
          </div>

          {error && (
            <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--danger-soft)', border: '1px solid #e8c9c3' }}>
              <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
            </div>
          )}

          <button type="submit" disabled={loading || !resetToken || !password || !confirm} style={{
            marginTop: 4, height: 46, borderRadius: 12, border: 'none',
            background: loading || !resetToken || !password || !confirm ? 'var(--sf-sunken)' : 'var(--ink)',
            color: loading || !resetToken || !password || !confirm ? 'var(--ink-3)' : '#fdf7eb',
            fontSize: 14, fontWeight: 700, cursor: loading || !resetToken || !password || !confirm ? 'not-allowed' : 'pointer',
          }}>
            {loading ? 'Saving…' : 'Set password'}
          </button>
        </form>
      </div>
    </div>
  );
}
