'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { useAdminAuth } from '@/stores/authStore';

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
  totp_code: z.string().optional(),
});
type LoginForm = z.infer<typeof loginSchema>;

export default function AdminLoginPage() {
  const router = useRouter();
  const setAuth = useAdminAuth((s) => s.setAuth);
  const [error, setError] = useState('');
  const [totpRequired, setTotpRequired] = useState(false);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    setError('');
    try {
      const resp = await fetch('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await resp.json();
      if (resp.status === 428) { setTotpRequired(true); return; }
      if (!resp.ok) { setError(json.detail ?? 'Login failed. Check your credentials.'); return; }
      setAuth(json.role ?? 'admin', data.email);
      router.push(json.totp_enabled ? '/admin/dashboard' : '/admin/security/mfa');
    } catch {
      setError('Network error. Please try again.');
    }
  };

  return (
    <div className="sf-login-shell">
      {/* Brand panel */}
      <div className="sf-login-brand-panel" style={{
        width: 420, background: '#13100c', color: '#f5efe1',
        display: 'flex', flexDirection: 'column', padding: '48px 44px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 56 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'var(--gold-2)', color: '#1a1612',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14,
          }}>S</div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 600 }}>SMEFlow</div>
            <div style={{ fontSize: 9.5, opacity: 0.45, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Admin · Ops</div>
          </div>
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 600, lineHeight: 1.15, letterSpacing: '-0.025em', marginBottom: 14 }}>
          Operations<br/>console
        </h1>
        <p style={{ fontSize: 13.5, color: 'rgba(245,239,225,0.55)', lineHeight: 1.6, marginBottom: 48 }}>
          KYC review, merchant management, lender pipeline, and fraud signals — all in one place.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, flex: 1 }}>
          {[
            { n: 'KYC queue', d: 'Review identity documents in real-time' },
            { n: 'Merchant registry', d: '4,000+ active businesses tracked' },
            { n: 'Fraud signals', d: 'Velocity, device, and pattern alerts' },
          ].map((f) => (
            <div key={f.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--gold-2)', marginTop: 5, flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{f.n}</div>
                <div style={{ fontSize: 11.5, color: 'rgba(245,239,225,0.45)', marginTop: 1 }}>{f.d}</div>
              </div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 10.5, color: 'rgba(245,239,225,0.3)', marginTop: 32 }}>
          v2026.5 · Internal use only
        </div>
      </div>

      {/* Form panel */}
      <div className="sf-login-form-panel" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '48px 40px' }}>
        <div style={{ width: '100%', maxWidth: 380 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 6 }}>
            Sign in
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', marginBottom: 28 }}>
            Use your ops team credentials
          </p>

          <form onSubmit={handleSubmit(onSubmit)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Email</label>
              <Input type="email" autoComplete="email" {...register('email')}
                style={{ height: 44, borderRadius: 10, borderColor: errors.email ? 'var(--danger)' : 'var(--sf-line-2)', fontSize: 14 }} />
              {errors.email && <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{errors.email.message}</p>}
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Password</label>
              <Input type="password" autoComplete="current-password" {...register('password')}
                style={{ height: 44, borderRadius: 10, borderColor: errors.password ? 'var(--danger)' : 'var(--sf-line-2)', fontSize: 14 }} />
              {errors.password && <p style={{ fontSize: 11.5, color: 'var(--danger)', marginTop: 4 }}>{errors.password.message}</p>}
            </div>

            {totpRequired && (
              <div>
                <label style={{ display: 'block', fontSize: 11.5, fontWeight: 600, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Authenticator code</label>
                <Input maxLength={6} inputMode="numeric" autoComplete="one-time-code" autoFocus {...register('totp_code')}
                  style={{ height: 44, borderRadius: 10, borderColor: 'var(--sf-line-2)', fontSize: 20, letterSpacing: '0.25em', textAlign: 'center', fontFamily: 'var(--font-mono)' }} />
                <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>6-digit code from your authenticator app</p>
              </div>
            )}

            {error && (
              <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--danger-soft)', border: '1px solid #e8c9c3' }}>
                <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
              </div>
            )}

            <button type="submit" disabled={isSubmitting} style={{
              marginTop: 4, height: 46, borderRadius: 12, border: 'none',
              background: isSubmitting ? 'var(--sf-sunken)' : '#13100c',
              color: isSubmitting ? 'var(--ink-3)' : '#f5efe1',
              fontSize: 14, fontWeight: 700, cursor: isSubmitting ? 'not-allowed' : 'pointer',
            }}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
