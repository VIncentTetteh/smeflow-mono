'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAgentAuth } from '@/stores/authStore';

type Step = 'phone' | 'otp';

const OTP_DIGITS = 6;

export default function AgentLoginPage() {
  const router = useRouter();
  const setAuth = useAgentAuth((s) => s.setAuth);
  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const requestOtp = async () => {
    if (!phone.trim()) return;
    setLoading(true); setError('');
    try {
      const resp = await fetch('/api/proxy/auth/otp/request', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      if (!resp.ok) { const j = await resp.json(); setError(j.detail ?? 'Could not send OTP.'); return; }
      setStep('otp');
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) return;
    setLoading(true); setError('');
    try {
      const resp = await fetch('/api/auth/agent', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp }),
      });
      const json = await resp.json();
      if (!resp.ok) { setError(json.detail ?? 'Invalid OTP. Please try again.'); return; }
      setAuth(json.role ?? 'agent', json.agent_id ?? '');
      router.push('/agent/dashboard');
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--sf-bg)', padding: '24px 16px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 40, justifyContent: 'center' }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'var(--gold)', color: '#1a1208',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16,
          }}>A</div>
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>SMEFlow</div>
            <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Agent Portal</div>
          </div>
        </div>

        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 18, padding: '28px 28px 24px' }}>
          {step === 'phone' ? (
            <>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 6 }}>
                Sign in
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 22 }}>
                Enter your Ghana phone number to receive a one-time code
              </p>

              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Phone number
              </label>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '0 14px', height: 52,
                background: 'var(--sf-bg)', border: '1.5px solid var(--sf-line-2)', borderRadius: 12,
                marginBottom: 14,
              }}>
                <span style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>🇬🇭 +233</span>
                <div style={{ width: 1, height: 22, background: 'var(--sf-line)' }} />
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && requestOtp()}
                  placeholder="024 000 0000"
                  style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 16, fontWeight: 500, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
                />
              </div>

              <p style={{ fontSize: 11.5, color: 'var(--ink-3)', marginBottom: 18 }}>
                SMS code sent via MTN, Telecel, or AirtelTigo
              </p>

              {error && (
                <div style={{ padding: '9px 12px', borderRadius: 9, background: 'var(--danger-soft)', marginBottom: 14 }}>
                  <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
                </div>
              )}

              <button
                onClick={requestOtp}
                disabled={loading || !phone.trim()}
                style={{
                  width: '100%', height: 46, borderRadius: 12, border: 'none',
                  background: loading || !phone.trim() ? 'var(--sf-sunken)' : 'var(--brand)',
                  color: loading || !phone.trim() ? 'var(--ink-3)' : '#fff',
                  fontSize: 14, fontWeight: 700, cursor: loading || !phone.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Sending…' : 'Send code'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => { setStep('phone'); setOtp(''); setError(''); }}
                style={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--ink-3)', marginBottom: 18 }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
                Change number
              </button>

              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.02em', marginBottom: 4 }}>
                Enter the code
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 22 }}>
                Sent to +233 {phone}
              </p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {Array.from({ length: OTP_DIGITS }).map((_, i) => (
                  <div key={i} style={{
                    flex: 1, height: 56, borderRadius: 12,
                    background: 'var(--sf-bg)',
                    border: `1.5px solid ${i < otp.length ? 'var(--brand)' : 'var(--sf-line-2)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 22, fontWeight: 700, color: 'var(--ink)',
                    fontFamily: 'var(--font-display)',
                  }}>
                    {otp[i] ?? ''}
                  </div>
                ))}
              </div>

              {/* Hidden real input for keyboard */}
              <input
                type="text"
                inputMode="numeric"
                maxLength={OTP_DIGITS}
                autoComplete="one-time-code"
                autoFocus
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, OTP_DIGITS))}
                onKeyDown={(e) => e.key === 'Enter' && otp.length >= 4 && verifyOtp()}
                style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
              />

              <p style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 18 }}>
                Resend in <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>0:30</span>
              </p>

              {error && (
                <div style={{ padding: '9px 12px', borderRadius: 9, background: 'var(--danger-soft)', marginBottom: 14 }}>
                  <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
                </div>
              )}

              <button
                onClick={verifyOtp}
                disabled={loading || otp.length < 4}
                style={{
                  width: '100%', height: 46, borderRadius: 12, border: 'none',
                  background: loading || otp.length < 4 ? 'var(--sf-sunken)' : 'var(--brand)',
                  color: loading || otp.length < 4 ? 'var(--ink-3)' : '#fff',
                  fontSize: 14, fontWeight: 700, cursor: loading || otp.length < 4 ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Verifying…' : 'Verify & sign in'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
