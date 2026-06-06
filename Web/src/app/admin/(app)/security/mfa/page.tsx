'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { apiClient } from '@/lib/api';

type Step = 'loading' | 'scan' | 'done';

export default function MfaSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    apiClient
      .post('/admin/auth/totp/enroll')
      .then((res) => { setSecret(res.data.secret); setOtpauthUri(res.data.otpauth_uri); setStep('scan'); })
      .catch(() => setError('Failed to generate QR code. Refresh to try again.'));
  }, []);

  const confirm = async () => {
    setError('');
    setConfirming(true);
    try {
      await apiClient.post('/admin/auth/totp/confirm', { code });
      setStep('done');
      setTimeout(() => router.push('/admin/dashboard'), 1500);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? 'Invalid code. Check your authenticator app and try again.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '48px 24px' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ marginBottom: 24, textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 14, background: '#1c1812',
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px',
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--gold-2)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3 4 6v6c0 4.5 3.5 8 8 9 4.5-1 8-4.5 8-9V6l-8-3Z"/>
            </svg>
          </div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.02em' }}>
            Set up two-factor authentication
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--ink-3)', marginTop: 6, lineHeight: 1.5 }}>
            Scan the QR code with Google Authenticator, Authy, or any TOTP app
          </p>
        </div>

        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 16, overflow: 'hidden' }}>
          {step === 'loading' && (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>
              Generating QR code…
            </div>
          )}

          {step === 'scan' && (
            <>
              {/* QR code */}
              <div style={{ padding: '28px', borderBottom: '1px solid var(--sf-line)', display: 'flex', justifyContent: 'center' }}>
                <div style={{ padding: 16, background: '#fff', borderRadius: 12, border: '1px solid var(--sf-line)' }}>
                  <QRCodeSVG value={otpauthUri} size={180} />
                </div>
              </div>

              <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
                {/* Manual key */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Can&apos;t scan? Enter this key manually
                  </label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--sf-sunken)', borderRadius: 10, border: '1px solid var(--sf-line)' }}>
                    <code style={{ flex: 1, fontSize: 11.5, fontFamily: 'var(--font-mono)', color: 'var(--ink)', wordBreak: 'break-all', letterSpacing: '0.06em' }}>
                      {secret}
                    </code>
                    <button onClick={() => { navigator.clipboard.writeText(secret); setCopied(true); }} style={{
                      all: 'unset', cursor: 'pointer', padding: '5px 10px', borderRadius: 7,
                      border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)',
                      fontSize: 11.5, fontWeight: 600, color: copied ? 'var(--brand)' : 'var(--ink-3)',
                      flexShrink: 0,
                    }}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>

                {/* TOTP input */}
                <div>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                    Enter the 6-digit code to confirm
                  </label>
                  <input
                    maxLength={6}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123 456"
                    value={code}
                    onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && confirm()}
                    style={{
                      width: '100%', height: 52, borderRadius: 12,
                      border: `1.5px solid ${error ? 'var(--danger)' : 'var(--sf-line-2)'}`,
                      background: 'var(--sf-bg)', outline: 'none',
                      fontSize: 24, fontFamily: 'var(--font-display)', fontWeight: 600,
                      letterSpacing: '0.3em', textAlign: 'center', color: 'var(--ink)',
                      boxSizing: 'border-box',
                    }}
                  />
                  {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 5 }}>{error}</p>}
                </div>

                <button
                  onClick={confirm}
                  disabled={code.length !== 6 || confirming}
                  style={{
                    height: 46, borderRadius: 12, border: 'none',
                    background: code.length !== 6 || confirming ? 'var(--sf-sunken)' : '#13100c',
                    color: code.length !== 6 || confirming ? 'var(--ink-4)' : '#f5efe1',
                    fontSize: 14, fontWeight: 700, cursor: code.length !== 6 || confirming ? 'not-allowed' : 'pointer',
                  }}
                >
                  {confirming ? 'Verifying…' : 'Verify and enable'}
                </button>
              </div>
            </>
          )}

          {step === 'done' && (
            <div style={{ padding: '48px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--brand)' }}>
                Two-factor authentication enabled
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 6 }}>Redirecting to dashboard…</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
