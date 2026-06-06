'use client';
import { useEffect, useState } from 'react';
import {
  useLenderProfile,
  useUpdateLenderSettings,
  useChangeLenderPassword,
  useTestWebhook,
  useRotateLenderKey,
} from '@/hooks/lender/useLenderData';

export default function LenderSettings() {
  const { data: profile } = useLenderProfile();
  const updateSettings = useUpdateLenderSettings();
  const changePassword = useChangeLenderPassword();
  const testWebhook = useTestWebhook();
  const rotateKey = useRotateLenderKey();

  const [webhookUrl, setWebhookUrl] = useState('');
  const [savedWebhook, setSavedWebhook] = useState(false);

  // Change password state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // Webhook test state
  const [webhookTestResult, setWebhookTestResult] = useState<{ status: string; http_status: number | null; latency_ms: number } | null>(null);

  // Key rotation state
  const [rotatePassword, setRotatePassword] = useState('');
  const [newKey, setNewKey] = useState<string | null>(null);
  const [rotateError, setRotateError] = useState<string | null>(null);

  useEffect(() => {
    if (profile?.webhook_url) setWebhookUrl(profile.webhook_url);
  }, [profile]);

  const keyStatus = profile?.api_key_hint
    ? `Key ending ${profile.api_key_hint}`
    : 'No active key hint available';
  const splitReady = !!profile?.settlement_ready;

  function saveWebhook() {
    updateSettings.mutate(
      { webhook_url: webhookUrl },
      {
        onSuccess: () => {
          setSavedWebhook(true);
          setTimeout(() => setSavedWebhook(false), 2000);
        },
      },
    );
  }

  function handleChangePassword() {
    setPwError(null);
    setPwSuccess(false);
    if (!currentPw || !newPw) { setPwError('All fields are required.'); return; }
    if (newPw !== confirmPw) { setPwError('New passwords do not match.'); return; }
    changePassword.mutate(
      { current_password: currentPw, new_password: newPw },
      {
        onSuccess: () => {
          setPwSuccess(true);
          setCurrentPw(''); setNewPw(''); setConfirmPw('');
        },
        onError: () => setPwError('Password change failed. Check your current password.'),
      },
    );
  }

  function handleTestWebhook() {
    setWebhookTestResult(null);
    testWebhook.mutate(undefined, {
      onSuccess: (data) => setWebhookTestResult(data),
      onError: () => setWebhookTestResult({ status: 'error', http_status: null, latency_ms: 0 }),
    });
  }

  function handleRotateKey() {
    setRotateError(null);
    setNewKey(null);
    if (!rotatePassword) { setRotateError('Enter your current password to confirm.'); return; }
    rotateKey.mutate(
      { current_password: rotatePassword },
      {
        onSuccess: (data) => {
          setNewKey(data.api_key);
          setRotatePassword('');
        },
        onError: () => setRotateError('Key rotation failed. Check your password and try again.'),
      },
    );
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', height: 44, borderRadius: 11,
    border: '1.5px solid var(--sf-line-2)',
    background: 'var(--sf-bg)', outline: 'none',
    padding: '0 14px', fontSize: 13.5, color: 'var(--ink)',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center',
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Lender</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>API access &amp; settings</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ maxWidth: 600, display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* API key card */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>API key status</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
              API keys are created and rotated by platform admins. This portal only shows the safe key hint.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 44, background: 'var(--sf-sunken)', border: '1.5px solid var(--sf-line-2)', borderRadius: 11 }}>
              <span className="sf-mono" style={{ flex: 1, fontSize: 12.5, color: 'var(--ink-2)', letterSpacing: '0.04em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {keyStatus}
              </span>
            </div>
          </div>

          {/* Settlement split card */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', flex: 1 }}>Repayment split settlement</div>
              <span className={`sf-pill ${splitReady ? 'sf-pill-success' : 'sf-pill-warn'}`}>
                {splitReady ? 'Ready' : 'Admin setup needed'}
              </span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14, lineHeight: 1.45 }}>
              Repayment collections use this Paystack split so lender proceeds route to your settlement account while SMEFlow keeps the configured platform fee.
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['Subaccount', profile?.paystack_subaccount_code ?? 'Not provisioned'],
                ['Split code', profile?.paystack_split_code ?? 'Not provisioned'],
                ['Bank code', profile?.settlement_bank_code ?? '—'],
                ['Account', profile?.settlement_account_hint ?? '—'],
                ['Platform fee', profile?.platform_fee_percent != null ? `${profile.platform_fee_percent}%` : '—'],
                ['Status', splitReady ? 'Repayments can use split' : 'Ask admin to provision split'],
              ].map(([label, value]) => (
                <div key={label} style={{ background: 'var(--sf-sunken)', border: '1px solid var(--sf-line)', borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
                  <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                  <div className="sf-mono" style={{ fontSize: 11.5, color: 'var(--ink)', marginTop: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Webhook card */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Webhook endpoint</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
              Receive real-time events for loan disbursements, repayments, and KYC updates via HTTP POST.
            </div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              HTTPS URL
            </label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhooks/smeflow"
              style={{ width: '100%', height: 44, borderRadius: 11, border: '1.5px solid var(--sf-line-2)', background: 'var(--sf-bg)', outline: 'none', padding: '0 14px', fontSize: 13.5, color: 'var(--ink)', boxSizing: 'border-box' }}
            />

            <button
              onClick={saveWebhook}
              disabled={!webhookUrl.startsWith('https://') || updateSettings.isPending}
              style={{
                height: 36, borderRadius: 9, border: 'none', marginTop: 10,
                background: savedWebhook ? 'var(--brand)' : (!webhookUrl.startsWith('https://') || updateSettings.isPending) ? 'var(--sf-sunken)' : 'var(--ink)',
                color: (!webhookUrl.startsWith('https://') || updateSettings.isPending) ? 'var(--ink-4)' : '#fff',
                fontSize: 12.5, fontWeight: 700, cursor: (!webhookUrl.startsWith('https://') || updateSettings.isPending) ? 'not-allowed' : 'pointer',
                padding: '0 16px', transition: 'background 0.2s',
              }}
            >
              {updateSettings.isPending ? 'Saving…' : savedWebhook ? 'Saved ✓' : 'Save webhook'}
            </button>
          </div>

          {/* Docs card */}
          <div style={{ background: 'var(--sf-sunken)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--brand-soft)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
              </svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>API reference</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>Endpoints, schemas, rate limits, and webhook event catalogue</div>
            </div>
            <button
              onClick={() => window.open('/api/docs', '_blank')}
              style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--brand)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--brand)' }}
            >
              View docs →
            </button>
          </div>

          {/* Change password card */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Change password</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
              Update your lender portal login password.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Current password</label>
                <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="Current password" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>New password</label>
                <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="New password" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Confirm new password</label>
                <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Confirm new password" style={inputStyle} />
              </div>
            </div>

            {pwError && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 22%, transparent)', borderRadius: 8, fontSize: 12, color: 'var(--danger)' }}>
                {pwError}
              </div>
            )}
            {pwSuccess && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'color-mix(in srgb, var(--brand) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--brand) 22%, transparent)', borderRadius: 8, fontSize: 12, color: 'var(--brand)' }}>
                Password changed successfully.
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={changePassword.isPending}
              style={{
                height: 36, borderRadius: 9, border: 'none', marginTop: 14,
                background: changePassword.isPending ? 'var(--sf-sunken)' : 'var(--ink)',
                color: changePassword.isPending ? 'var(--ink-4)' : '#fff',
                fontSize: 12.5, fontWeight: 700,
                cursor: changePassword.isPending ? 'not-allowed' : 'pointer',
                padding: '0 16px',
              }}
            >
              {changePassword.isPending ? 'Saving…' : 'Update password'}
            </button>
          </div>

          {/* Webhook test card — only shown if webhook_url is set */}
          {profile?.webhook_url && (
            <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Test webhook delivery</div>
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14 }}>
                Send a test event to your configured webhook URL to verify reachability.
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handleTestWebhook}
                  disabled={testWebhook.isPending}
                  style={{
                    height: 36, borderRadius: 9, border: 'none',
                    background: testWebhook.isPending ? 'var(--sf-sunken)' : 'var(--ink)',
                    color: testWebhook.isPending ? 'var(--ink-4)' : '#fff',
                    fontSize: 12.5, fontWeight: 700,
                    cursor: testWebhook.isPending ? 'not-allowed' : 'pointer',
                    padding: '0 16px',
                  }}
                >
                  {testWebhook.isPending ? 'Sending…' : 'Send test event'}
                </button>

                {webhookTestResult && (
                  <span
                    className={`sf-pill ${webhookTestResult.status === 'delivered' || (webhookTestResult.http_status !== null && webhookTestResult.http_status < 300) ? 'sf-pill-success' : 'sf-pill-danger'}`}
                    style={{ fontSize: 12 }}
                  >
                    {webhookTestResult.status === 'delivered' || (webhookTestResult.http_status !== null && webhookTestResult.http_status < 300)
                      ? `Delivered (${webhookTestResult.http_status}, ${webhookTestResult.latency_ms}ms)`
                      : webhookTestResult.http_status
                        ? `Failed (${webhookTestResult.http_status})`
                        : 'Failed (no response)'}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* API key rotation card */}
          <div style={{ background: 'var(--sf-surface)', border: '1px solid color-mix(in srgb, var(--danger) 30%, var(--sf-line))', borderRadius: 14, padding: '20px 22px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginBottom: 4 }}>Rotate API key</div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 14, lineHeight: 1.5 }}>
              Rotating your API key immediately invalidates the current key. Any integrations using the current key will stop working until updated with the new key.
            </div>

            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Confirm with your password
            </label>
            <input
              type="password"
              value={rotatePassword}
              onChange={(e) => setRotatePassword(e.target.value)}
              placeholder="Current password"
              style={inputStyle}
            />

            {rotateError && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'color-mix(in srgb, var(--danger) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 22%, transparent)', borderRadius: 8, fontSize: 12, color: 'var(--danger)' }}>
                {rotateError}
              </div>
            )}

            {newKey && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--danger)', marginBottom: 6 }}>
                  This key will not be shown again. Copy it now.
                </div>
                <div style={{
                  padding: '10px 14px', borderRadius: 9,
                  background: 'var(--sf-sunken)', border: '1.5px solid var(--sf-line-2)',
                  fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--ink)',
                  wordBreak: 'break-all', lineHeight: 1.5,
                }}>
                  {newKey}
                </div>
              </div>
            )}

            <button
              onClick={handleRotateKey}
              disabled={rotateKey.isPending || !!newKey}
              style={{
                height: 36, borderRadius: 9, border: 'none', marginTop: 14,
                background: (rotateKey.isPending || !!newKey) ? 'var(--sf-sunken)' : 'var(--danger)',
                color: (rotateKey.isPending || !!newKey) ? 'var(--ink-4)' : '#fff',
                fontSize: 12.5, fontWeight: 700,
                cursor: (rotateKey.isPending || !!newKey) ? 'not-allowed' : 'pointer',
                padding: '0 16px',
              }}
            >
              {rotateKey.isPending ? 'Rotating…' : newKey ? 'Key rotated' : 'Rotate key'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
