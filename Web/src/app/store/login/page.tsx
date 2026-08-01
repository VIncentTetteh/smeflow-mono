'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStoreAuth } from '@/stores/authStore';

type Method = 'phone' | 'email';
type Step = 'identify' | 'otp';

const OTP_DIGITS = 6;

export default function StoreLoginPage() {
  const router = useRouter();
  const setAuth = useStoreAuth((s) => s.setAuth);

  const [method, setMethod] = useState<Method>('phone');
  const [step, setStep] = useState<Step>('identify');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const identifier = method === 'phone' ? phone : email;

  const requestOtp = async () => {
    if (!identifier.trim()) return;
    setLoading(true);
    setError('');
    try {
      const url =
        method === 'phone' ? '/api/proxy/auth/otp/request' : '/api/proxy/auth/email/login/request';
      const body = method === 'phone' ? { phone } : { email };
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const j = await resp.json();
        setError(j.detail ?? 'Could not send the code.');
        return;
      }
      setStep('otp');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (otp.length < 4) return;
    setLoading(true);
    setError('');
    try {
      const body =
        method === 'phone' ? { mode: 'phone', phone, otp } : { mode: 'email', email, otp };
      const resp = await fetch('/api/auth/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await resp.json();
      if (!resp.ok) {
        setError(json.detail ?? 'Invalid code. Please try again.');
        return;
      }
      setAuth(json.role ?? 'none', json.user_id ?? '', json.business_id ?? null);
      router.push('/store/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchMethod = (m: Method) => {
    setMethod(m);
    setStep('identify');
    setOtp('');
    setError('');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--sf-bg)',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Logo */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 40,
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              background: 'var(--gold)',
              color: '#1a1208',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            S
          </div>
          <div>
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
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

        <div
          style={{
            background: 'var(--sf-surface)',
            border: '1px solid var(--sf-line)',
            borderRadius: 18,
            padding: '28px 28px 24px',
          }}
        >
          {step === 'identify' ? (
            <>
              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  fontWeight: 600,
                  color: 'var(--ink)',
                  letterSpacing: '-0.02em',
                  marginBottom: 6,
                }}
              >
                Sign in
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 20 }}>
                Manage your store from anywhere. We&apos;ll send a one-time code.
              </p>

              {/* Method toggle */}
              <div
                style={{
                  display: 'flex',
                  gap: 4,
                  padding: 4,
                  background: 'var(--sf-bg)',
                  border: '1px solid var(--sf-line)',
                  borderRadius: 12,
                  marginBottom: 18,
                }}
              >
                {(['phone', 'email'] as Method[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => switchMethod(m)}
                    style={{
                      all: 'unset',
                      flex: 1,
                      textAlign: 'center',
                      cursor: 'pointer',
                      padding: '8px 0',
                      borderRadius: 9,
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: method === m ? '#fff' : 'var(--ink-3)',
                      background: method === m ? 'var(--brand)' : 'transparent',
                    }}
                  >
                    {m === 'phone' ? 'Phone' : 'Email'}
                  </button>
                ))}
              </div>

              <label
                style={{
                  display: 'block',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--ink-3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  marginBottom: 6,
                }}
              >
                {method === 'phone' ? 'Phone number' : 'Email address'}
              </label>

              {method === 'phone' ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 14px',
                    height: 52,
                    background: 'var(--sf-bg)',
                    border: '1.5px solid var(--sf-line-2)',
                    borderRadius: 12,
                    marginBottom: 18,
                  }}
                >
                  <span
                    style={{
                      fontSize: 14,
                      color: 'var(--ink-2)',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    🇬🇭 +233
                  </span>
                  <div style={{ width: 1, height: 22, background: 'var(--sf-line)' }} />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && requestOtp()}
                    placeholder="024 000 0000"
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 16,
                      fontWeight: 500,
                      color: 'var(--ink)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 14px',
                    height: 52,
                    background: 'var(--sf-bg)',
                    border: '1.5px solid var(--sf-line-2)',
                    borderRadius: 12,
                    marginBottom: 18,
                  }}
                >
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && requestOtp()}
                    placeholder="you@business.com"
                    style={{
                      flex: 1,
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      fontSize: 16,
                      fontWeight: 500,
                      color: 'var(--ink)',
                    }}
                  />
                </div>
              )}

              {error && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 9,
                    background: 'var(--danger-soft)',
                    marginBottom: 14,
                  }}
                >
                  <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
                </div>
              )}

              <button
                onClick={requestOtp}
                disabled={loading || !identifier.trim()}
                style={{
                  width: '100%',
                  height: 46,
                  borderRadius: 12,
                  border: 'none',
                  background: loading || !identifier.trim() ? 'var(--sf-sunken)' : 'var(--brand)',
                  color: loading || !identifier.trim() ? 'var(--ink-3)' : '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: loading || !identifier.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {loading ? 'Sending…' : 'Send code'}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => {
                  setStep('identify');
                  setOtp('');
                  setError('');
                }}
                style={{
                  all: 'unset',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  color: 'var(--ink-3)',
                  marginBottom: 18,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M15 18l-6-6 6-6" />
                </svg>
                {method === 'phone' ? 'Change number' : 'Change email'}
              </button>

              <h2
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 22,
                  fontWeight: 600,
                  color: 'var(--ink)',
                  letterSpacing: '-0.02em',
                  marginBottom: 4,
                }}
              >
                Enter the code
              </h2>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 22 }}>
                Sent to {method === 'phone' ? `+233 ${phone}` : email}
              </p>

              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {Array.from({ length: OTP_DIGITS }).map((_, i) => (
                  <div
                    key={i}
                    style={{
                      flex: 1,
                      height: 56,
                      borderRadius: 12,
                      background: 'var(--sf-bg)',
                      border: `1.5px solid ${i < otp.length ? 'var(--brand)' : 'var(--sf-line-2)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 22,
                      fontWeight: 700,
                      color: 'var(--ink)',
                      fontFamily: 'var(--font-display)',
                    }}
                  >
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

              {error && (
                <div
                  style={{
                    padding: '9px 12px',
                    borderRadius: 9,
                    background: 'var(--danger-soft)',
                    marginBottom: 14,
                  }}
                >
                  <p style={{ fontSize: 12.5, color: 'var(--danger)' }}>{error}</p>
                </div>
              )}

              <button
                onClick={verifyOtp}
                disabled={loading || otp.length < 4}
                style={{
                  width: '100%',
                  height: 46,
                  borderRadius: 12,
                  border: 'none',
                  background: loading || otp.length < 4 ? 'var(--sf-sunken)' : 'var(--brand)',
                  color: loading || otp.length < 4 ? 'var(--ink-3)' : '#fff',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: loading || otp.length < 4 ? 'not-allowed' : 'pointer',
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
