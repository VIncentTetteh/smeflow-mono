'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useOnboardingMutations } from '@/hooks/agent/useAgentData';

type StepId = 'phone' | 'profile' | 'documents' | 'kyc' | 'momo';

const STEPS: { id: StepId; label: string; desc: string }[] = [
  { id: 'phone',     label: 'Phone & OTP',        desc: "Verify the trader's Ghana phone number" },
  { id: 'profile',   label: 'Business profile',   desc: 'Business name, category, location' },
  { id: 'documents', label: 'Ghana Card + photo',  desc: 'Front, back, and selfie upload' },
  { id: 'kyc',       label: 'KYC submission',      desc: 'Submit for admin review' },
  { id: 'momo',      label: 'MoMo wallet link',    desc: 'Link MTN, Telecel, or AirtelTigo' },
];

const CATEGORIES = ['Retail', 'Wholesale', 'Pharmacy', 'Food & Beverage', 'Electronics', 'Auto Parts', 'Cosmetics', 'Other'];
const REGIONS = ['Greater Accra', 'Ashanti', 'Central', 'Eastern', 'Northern', 'Upper East', 'Upper West', 'Volta', 'Western', 'Other'];
const PROVIDERS = ['MTN', 'Telecel', 'AirtelTigo'];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
      {children}
    </label>
  );
}

function FieldInput({ value, onChange, placeholder, type = 'text' }: { value: string; onChange: (v: string) => void; placeholder?: string; type?: string }) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ width: '100%', height: 44, borderRadius: 11, border: '1.5px solid var(--sf-line-2)', background: 'var(--sf-bg)', outline: 'none', padding: '0 14px', fontSize: 14, color: 'var(--ink)', boxSizing: 'border-box' }}
    />
  );
}

function FieldSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ width: '100%', height: 44, borderRadius: 11, border: '1.5px solid var(--sf-line-2)', background: 'var(--sf-bg)', outline: 'none', padding: '0 14px', fontSize: 14, color: value ? 'var(--ink)' : 'var(--ink-4)', boxSizing: 'border-box', cursor: 'pointer' }}
    >
      <option value="">Select…</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function PrimaryBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 44, borderRadius: 11, border: 'none',
        background: disabled ? 'var(--sf-sunken)' : 'var(--brand)',
        color: disabled ? 'var(--ink-4)' : '#fff',
        fontSize: 13.5, fontWeight: 700, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.7 : 1,
        width: '100%',
      }}
    >
      {children}
    </button>
  );
}

export default function AgentOnboarding() {
  const router = useRouter();
  const { startOnboarding, createBusiness, submitKyc, addWallet, completeOnboarding } = useOnboardingMutations();

  const [activeStep, setActiveStep] = useState<StepId>('phone');
  const [userId, setUserId] = useState<string | null>(null);
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Step 1
  const [phone, setPhone] = useState('');
  // Step 2
  const [bizName, setBizName] = useState('');
  const [category, setCategory] = useState('');
  const [region, setRegion] = useState('');
  // Step 3
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [tin, setTin] = useState('');
  const [kycFiles, setKycFiles] = useState<File[]>([]);
  // Step 5
  const [momoProvider, setMomoProvider] = useState('');
  const [momoPhone, setMomoPhone] = useState('');

  const currentIdx = STEPS.findIndex(s => s.id === activeStep);

  function advanceTo(step: StepId) {
    setApiError(null);
    setActiveStep(step);
  }

  async function handlePhoneContinue() {
    setApiError(null);
    try {
      const result = await startOnboarding.mutateAsync({ phone: '+233' + phone.trim().replace(/^0/, '') });
      setUserId(result.user_id);
      advanceTo('profile');
    } catch (e: unknown) {
      setApiError((e as Error)?.message ?? 'Failed to send code');
    }
  }

  async function handleProfileSave() {
    if (!userId) return;
    setApiError(null);
    try {
      const result = await createBusiness.mutateAsync({ user_id: userId, business_name: bizName.trim(), category, region });
      setBusinessId(result.id);
      advanceTo('documents');
    } catch (e: unknown) {
      setApiError((e as Error)?.message ?? 'Failed to save business');
    }
  }

  async function handleDocumentsContinue() {
    if (!businessId) return;
    setApiError(null);
    try {
      await submitKyc.mutateAsync({ businessId, ghana_card_id: ghanaCardId.trim(), tin: tin.trim() || undefined });
      advanceTo('kyc');
    } catch (e: unknown) {
      setApiError((e as Error)?.message ?? 'Failed to submit KYC');
    }
  }

  async function handleComplete() {
    if (!businessId) return;
    setApiError(null);
    try {
      await addWallet.mutateAsync({ businessId, provider: momoProvider.toLowerCase(), phone: momoPhone.trim() });
      await completeOnboarding.mutateAsync(businessId);
      setDone(true);
    } catch (e: unknown) {
      setApiError((e as Error)?.message ?? 'Failed to complete onboarding');
    }
  }

  if (done) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--brand)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="sf-display" style={{ fontSize: 22, fontWeight: 600, color: 'var(--ink)' }}>Onboarding complete!</div>
          <div style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 6 }}>{bizName} is now in the review queue.</div>
        </div>
        <button
          onClick={() => router.push('/agent/traders')}
          style={{ height: 44, padding: '0 28px', borderRadius: 11, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}
        >
          View traders →
        </button>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Agent</div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Onboard business</div>
        </div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>Step {currentIdx + 1} of {STEPS.length}</span>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto', display: 'flex', gap: 22 }}>
        {/* Stepper */}
        <div style={{ width: 240, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {STEPS.map((s, i) => {
              const done = i < currentIdx;
              const active = s.id === activeStep;
              return (
                <div key={s.id} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 12,
                  padding: '10px 12px', borderRadius: 12,
                  background: active ? 'var(--brand-soft)' : 'transparent',
                }}>
                  <div style={{
                    width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                    background: done ? 'var(--brand)' : active ? 'var(--brand)' : 'var(--sf-sunken)',
                    color: done || active ? '#fff' : 'var(--ink-3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, marginTop: 1,
                  }}>
                    {done ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    ) : i + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: active ? 600 : 500, color: active ? 'var(--brand)' : done ? 'var(--ink-3)' : 'var(--ink)' }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>{s.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Form area */}
        <div style={{ flex: 1, maxWidth: 480 }}>
          <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 16, padding: '24px 24px 20px' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--ink)', marginBottom: 18 }}>
              {STEPS[currentIdx].label}
            </h3>

            {apiError && (
              <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)', fontSize: 13, color: 'var(--danger)' }}>
                {apiError}
              </div>
            )}

            {activeStep === 'phone' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <Label>Trader phone number</Label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 48, background: 'var(--sf-bg)', border: '1.5px solid var(--sf-line-2)', borderRadius: 12 }}>
                    <span style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 600 }}>🇬🇭 +233</span>
                    <div style={{ width: 1, height: 22, background: 'var(--sf-line)' }} />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="024 000 0000"
                      style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
                    />
                  </div>
                </div>
                <PrimaryBtn
                  onClick={handlePhoneContinue}
                  disabled={!phone.trim() || startOnboarding.isPending}
                >
                  {startOnboarding.isPending ? 'Sending…' : 'Send code & continue'}
                </PrimaryBtn>
              </div>
            )}

            {activeStep === 'profile' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <Label>Business name</Label>
                  <FieldInput value={bizName} onChange={setBizName} placeholder="Esi Wholesale" />
                </div>
                <div>
                  <Label>Category</Label>
                  <FieldSelect value={category} onChange={setCategory} options={CATEGORIES} />
                </div>
                <div>
                  <Label>Region</Label>
                  <FieldSelect value={region} onChange={setRegion} options={REGIONS} />
                </div>
                <PrimaryBtn
                  onClick={handleProfileSave}
                  disabled={!bizName.trim() || !category || !region || createBusiness.isPending}
                >
                  {createBusiness.isPending ? 'Saving…' : 'Save & continue'}
                </PrimaryBtn>
              </div>
            )}

            {activeStep === 'documents' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <Label>Ghana Card ID</Label>
                  <FieldInput value={ghanaCardId} onChange={setGhanaCardId} placeholder="GHA-000000000-0" />
                </div>
                <div>
                  <Label>GRA TIN (optional)</Label>
                  <FieldInput value={tin} onChange={setTin} placeholder="P000000000" />
                </div>
                <div>
                  <Label>Ghana Card photo (front + back)</Label>
                  <label style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    padding: '24px', background: 'var(--sf-sunken)', borderRadius: 12, border: `2px dashed ${kycFiles.length > 0 ? 'var(--brand)' : 'var(--sf-line-2)'}`,
                    cursor: 'pointer',
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={kycFiles.length > 0 ? 'var(--brand)' : 'var(--ink-4)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 8 }}>
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {kycFiles.length === 0 ? (
                      <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Tap to upload Ghana Card + selfie</span>
                    ) : (
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 12.5, color: 'var(--brand)', fontWeight: 600 }}>{kycFiles.length} file{kycFiles.length !== 1 ? 's' : ''} selected</div>
                        {kycFiles.map((f, i) => (
                          <div key={i} style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>{f.name}</div>
                        ))}
                      </div>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: 'none' }}
                      onChange={(e) => setKycFiles(Array.from(e.target.files ?? []))}
                    />
                  </label>
                </div>
                <PrimaryBtn
                  onClick={handleDocumentsContinue}
                  disabled={!ghanaCardId.trim() || kycFiles.length === 0 || submitKyc.isPending}
                >
                  {submitKyc.isPending ? 'Submitting…' : 'Submit KYC & continue'}
                </PrimaryBtn>
              </div>
            )}

            {activeStep === 'kyc' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 14, background: 'color-mix(in srgb, var(--gold-2) 10%, transparent)', borderRadius: 12, border: '1px solid color-mix(in srgb, var(--gold-2) 20%, transparent)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--gold-2)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>KYC submitted</div>
                    <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2 }}>Admin review typically takes 1–24 hours</div>
                  </div>
                </div>
                <PrimaryBtn onClick={() => advanceTo('momo')} disabled={false}>
                  Continue to MoMo →
                </PrimaryBtn>
              </div>
            )}

            {activeStep === 'momo' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <Label>MoMo provider</Label>
                  <FieldSelect value={momoProvider} onChange={setMomoProvider} options={PROVIDERS} />
                </div>
                <div>
                  <Label>MoMo phone number</Label>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', height: 48, background: 'var(--sf-bg)', border: '1.5px solid var(--sf-line-2)', borderRadius: 12 }}>
                    <span style={{ fontSize: 14, color: 'var(--ink-2)', fontWeight: 600 }}>🇬🇭 +233</span>
                    <div style={{ width: 1, height: 22, background: 'var(--sf-line)' }} />
                    <input
                      type="tel"
                      value={momoPhone}
                      onChange={(e) => setMomoPhone(e.target.value)}
                      placeholder="024 000 0000"
                      style={{ flex: 1, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, color: 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}
                    />
                  </div>
                </div>
                <PrimaryBtn
                  onClick={handleComplete}
                  disabled={!momoProvider || !momoPhone.trim() || addWallet.isPending || completeOnboarding.isPending}
                >
                  {(addWallet.isPending || completeOnboarding.isPending) ? 'Completing…' : 'Complete onboarding'}
                </PrimaryBtn>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
