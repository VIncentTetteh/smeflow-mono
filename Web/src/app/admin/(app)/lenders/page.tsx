'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useAdminLenders, useCreateLender, useToggleLenderActive } from '@/hooks/admin/useAdminPeople';

const lenderSchema = z.object({
  name: z.string().min(2, 'Company name must be at least 2 characters'),
  contact_email: z.string().email('Invalid email'),
  totp_code: z.string().regex(/^\d{6}$/, 'Must be 6 digits').or(z.literal('')).optional(),
});
type LenderForm = z.infer<typeof lenderSchema>;

type Lender = {
  id: string;
  lender_id: string;
  name: string;
  contact_email: string | null;
  is_active: boolean;
  created_at: string;
};

function LenderRow({ lender, index, total }: { lender: Lender; index: number; total: number }) {
  const [confirm, setConfirm] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const toggle = useToggleLenderActive();

  const handleToggle = async () => {
    await toggle.mutateAsync({
      lenderId: lender.lender_id,
      active: !lender.is_active,
      totp_code: totpCode.trim() || undefined,
    });
    setTotpCode('');
    setConfirm(false);
  };

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 120px 180px',
      gap: 10, padding: '13px 18px',
      borderBottom: index < total - 1 ? '1px solid var(--sf-line)' : 'none',
      alignItems: 'center', fontSize: 13,
      transition: 'background 0.1s',
      opacity: lender.is_active ? 1 : 0.6,
    }}
      onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = 'var(--sf-sunken)')}
      onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = 'transparent')}
    >
      <div>
        <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{lender.name}</div>
        <div className="sf-mono" style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 1 }}>{lender.lender_id}</div>
      </div>
      <span style={{ color: 'var(--ink-2)' }}>{lender.contact_email || '—'}</span>
      <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
        {new Date(lender.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={`sf-pill ${lender.is_active ? 'sf-pill-success' : 'sf-pill-neutral'}`}>
          {lender.is_active ? 'Active' : 'Inactive'}
        </span>
        {!confirm && (
          <button
            onClick={() => setConfirm(true)}
            style={{
              padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer',
              border: lender.is_active ? '1px solid var(--danger)' : '1px solid var(--brand)',
              background: 'transparent',
              color: lender.is_active ? 'var(--danger)' : 'var(--brand)',
            }}
          >
            {lender.is_active ? 'Disable' : 'Enable'}
          </button>
        )}
        {confirm && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value)}
              placeholder="TOTP"
              maxLength={6}
              inputMode="numeric"
              style={{ width: 76, height: 24, borderRadius: 6, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            />
            <button
              onClick={handleToggle}
              disabled={toggle.isPending}
              style={{
                padding: '3px 9px', borderRadius: 6, border: 'none',
                background: lender.is_active ? 'var(--danger)' : 'var(--brand)',
                color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              {toggle.isPending ? '…' : 'Yes'}
            </button>
            <button
              onClick={() => { setTotpCode(''); setConfirm(false); }}
              style={{
                padding: '3px 9px', borderRadius: 6,
                border: '1px solid var(--sf-line)', background: 'transparent',
                fontSize: 11, color: 'var(--ink-3)', cursor: 'pointer', fontWeight: 600,
              }}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminLenders() {
  const { data, isLoading } = useAdminLenders();
  const lenders = data?.items ?? [];
  const createLender = useCreateLender();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [portalEmail, setPortalEmail] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<LenderForm>({
    resolver: zodResolver(lenderSchema),
  });

  const onSubmit = async (data: LenderForm) => {
    const result = await createLender.mutateAsync({
      lender_id: data.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
      name: data.name,
      contact_email: data.contact_email,
      totp_code: data.totp_code || undefined,
    });
    reset();
    setSheetOpen(false);
    if (result?.api_key) {
      setApiKey(result.api_key);
      setTemporaryPassword(result.temporary_password);
      setPortalEmail(result.portal_email);
      setCopied(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        height: 56, padding: '0 22px', borderBottom: '1px solid var(--sf-line)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'var(--sf-surface)', flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--ink-3)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Finance</div>
          <div className="sf-display" style={{ fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Lenders</div>
        </div>
        <div style={{ flex: 1 }} />
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger style={{
              padding: '8px 16px', borderRadius: 9, border: 'none',
              background: 'var(--gold-2)', color: '#1a1612',
              fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Add lender
          </SheetTrigger>
          <SheetContent style={{ background: '#1c1812', color: '#f5efe1', border: 'none' }}>
            <SheetHeader>
              <SheetTitle style={{ color: '#f5efe1', fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>
                Create lender account
              </SheetTitle>
            </SheetHeader>
            <form onSubmit={handleSubmit(onSubmit)} style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[
                { label: 'Company name', key: 'name' as const, placeholder: 'GhanaFin Ltd', required: true },
                { label: 'Portal email', key: 'contact_email' as const, placeholder: 'ops@ghanafin.com', required: true },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(245,239,225,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</label>
                  <Input {...register(key)} placeholder={placeholder}
                    style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42 }} />
                  {errors[key] && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors[key]?.message}</p>}
                </div>
              ))}
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'rgba(245,239,225,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Admin TOTP code (if enabled)</label>
                <Input {...register('totp_code')} placeholder="6-digit authenticator code" maxLength={6} inputMode="numeric"
                  style={{ background: 'rgba(245,239,225,0.07)', border: '1px solid rgba(245,239,225,0.15)', color: '#f5efe1', borderRadius: 9, height: 42, fontFamily: 'var(--font-mono)' }} />
                {errors.totp_code && <p style={{ fontSize: 11.5, color: '#f08070', marginTop: 4 }}>{errors.totp_code.message}</p>}
              </div>
              <button type="submit" disabled={isSubmitting || createLender.isPending} style={{
                marginTop: 8, height: 44, borderRadius: 10, border: 'none',
                background: isSubmitting || createLender.isPending ? 'rgba(245,239,225,0.1)' : 'var(--gold-2)',
                color: isSubmitting || createLender.isPending ? 'rgba(245,239,225,0.4)' : '#1a1612',
                fontSize: 13.5, fontWeight: 700, cursor: isSubmitting || createLender.isPending ? 'not-allowed' : 'pointer',
              }}>
                {createLender.isPending ? 'Creating…' : 'Create lender'}
              </button>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <div style={{ flex: 1, padding: 22, overflow: 'auto' }}>
        <div style={{ background: 'var(--sf-surface)', border: '1px solid var(--sf-line)', borderRadius: 14, overflow: 'hidden' }}>
          <div style={{
            display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 120px 180px',
            gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--sf-line)',
            fontSize: 10.5, color: 'var(--ink-4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            <div>Company</div><div>Email</div><div>Joined</div><div>Status</div>
          </div>

          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} style={{
                display: 'grid', gridTemplateColumns: '1.5fr 1.5fr 120px 180px',
                gap: 10, padding: '14px 18px', borderBottom: i < 2 ? '1px solid var(--sf-line)' : 'none',
              }}>
                {Array.from({ length: 4 }).map((__, j) => (
                  <div key={j} style={{ height: 14, background: 'var(--sf-sunken)', borderRadius: 4 }} />
                ))}
              </div>
            ))
          ) : lenders.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--ink-3)', fontSize: 13 }}>No lenders yet</div>
          ) : (
            lenders.map((lender, i, a) => (
              <LenderRow key={lender.id} lender={lender} index={i} total={a.length} />
            ))
          )}
        </div>
      </div>

      {/* One-time credentials dialog */}
      <Dialog open={!!apiKey} onOpenChange={(open) => { if (!open) setApiKey(null); }}>
        <DialogContent style={{ maxWidth: 480 }}>
          <DialogHeader>
            <DialogTitle>
              <span className="sf-display" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                Copy lender credentials — shown once
              </span>
            </DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            Share the portal email and temporary password with the lender. They must reset the password on first login. The API key remains for system integrations.
          </p>
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--sf-sunken)', borderRadius: 10, border: '1px solid var(--sf-line)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Portal email</div>
            <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)', wordBreak: 'break-all' }}>
              {portalEmail}
            </code>
          </div>
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--sf-sunken)', borderRadius: 10, border: '1px solid var(--sf-line)' }}>
            <div style={{ fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Temporary password</div>
            <code style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)', wordBreak: 'break-all' }}>
              {temporaryPassword}
            </code>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
            padding: '10px 14px', background: 'var(--sf-sunken)', borderRadius: 10,
            border: '1px solid var(--sf-line)',
          }}>
            <code style={{ flex: 1, fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--ink)', wordBreak: 'break-all' }}>
              {apiKey}
            </code>
            <button onClick={() => {
              navigator.clipboard.writeText(`Portal email: ${portalEmail}\nTemporary password: ${temporaryPassword}\nAPI key: ${apiKey}`);
              setCopied(true);
            }} style={{
              all: 'unset', cursor: 'pointer', padding: '6px 12px', borderRadius: 7,
              border: '1px solid var(--sf-line-2)', background: 'var(--sf-surface)',
              fontSize: 12, fontWeight: 600, color: copied ? 'var(--brand)' : 'var(--ink-2)',
              flexShrink: 0,
            }}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button onClick={() => setApiKey(null)} style={{
            width: '100%', marginTop: 12, height: 44, borderRadius: 10, border: 'none',
            background: 'var(--ink)', color: '#fdf7eb',
            fontSize: 13.5, fontWeight: 700, cursor: 'pointer',
          }}>
            I have copied the key
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
