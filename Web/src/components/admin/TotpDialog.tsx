'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type TotpDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  isPending?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (code?: string) => void;
};

export function TotpDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  isPending = false,
  onOpenChange,
  onConfirm,
}: TotpDialogProps) {
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!open) setCode('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: 420 }}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {description && <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-3)' }}>{description}</p>}
          <label style={{ display: 'block', fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Admin TOTP code
          </label>
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="6-digit authenticator code"
            maxLength={6}
            inputMode="numeric"
            autoComplete="one-time-code"
            style={{ height: 38, borderRadius: 9, fontFamily: 'var(--font-mono)', letterSpacing: '0.16em' }}
          />
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--ink-4)' }}>
            Leave blank only if MFA is not enabled on your admin account.
          </p>
        </div>
        <DialogFooter>
          <button
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            style={{
              padding: '8px 14px',
              borderRadius: 9,
              border: '1px solid var(--sf-line)',
              background: 'transparent',
              color: 'var(--ink-2)',
              fontSize: 13,
              fontWeight: 600,
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(code.trim() || undefined)}
            disabled={isPending}
            style={{
              padding: '8px 16px',
              borderRadius: 9,
              border: 'none',
              background: isPending ? 'var(--brand-soft-2)' : 'var(--brand)',
              color: isPending ? 'var(--ink-3)' : '#fff',
              fontSize: 13,
              fontWeight: 700,
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'Working...' : confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
