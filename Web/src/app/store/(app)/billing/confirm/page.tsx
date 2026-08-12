'use client';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useVerifySubscription } from '@/hooks/store/useStoreBilling';
import { PageShell, Card, Button, Spinner } from '@/components/store/kit';

const MAX_ATTEMPTS = 6;
const RETRY_DELAY_MS = 2500;

type Status = 'checking' | 'activated' | 'pending' | 'error';

export default function BillingConfirmPage() {
  const params = useSearchParams();
  const verify = useVerifySubscription();
  const [status, setStatus] = useState<Status>('checking');
  const [plan, setPlan] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const reference = params.get('ref') || params.get('reference') || params.get('trxref');
    if (!reference) {
      setStatus('error');
      return;
    }

    let cancelled = false;
    const attempt = async (n: number) => {
      try {
        const res = await verify.mutateAsync(reference);
        if (cancelled) return;
        if (res.activated) {
          setPlan(res.plan ?? null);
          setStatus('activated');
          return;
        }
      } catch {
        // keep retrying — Paystack verification may still be settling
      }
      if (cancelled) return;
      if (n < MAX_ATTEMPTS) {
        setTimeout(() => attempt(n + 1), RETRY_DELAY_MS);
      } else {
        setStatus('pending');
      }
    };

    void attempt(0);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const goToBilling = () => {
    // Hard navigation so React Query's billing cache (populated before the
    // redirect to Paystack) gets a real refetch rather than a stale hit.
    window.location.href = '/store/billing';
  };

  return (
    <PageShell title="Confirming payment" subtitle="Hang tight while we activate your plan">
      <Card style={{ maxWidth: 420, margin: '40px auto', textAlign: 'center', padding: 32 }}>
        {status === 'checking' && (
          <>
            <Spinner label="Verifying your payment…" />
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12 }}>
              This usually takes a few seconds.
            </p>
          </>
        )}
        {status === 'activated' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: 'var(--ink)' }}>
              {plan ? `You're now on the ${plan} plan` : 'Subscription activated'}
            </div>
            <div style={{ marginTop: 18 }}>
              <Button onClick={goToBilling}>Go to Billing</Button>
            </div>
          </>
        )}
        {status === 'pending' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⏳</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              Still confirming with Paystack
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
              If you completed the payment, this can take a minute to settle. You can check back
              on the Billing page — we&apos;ll keep verifying in the background.
            </p>
            <div style={{ marginTop: 18 }}>
              <Button onClick={goToBilling}>Go to Billing</Button>
            </div>
          </>
        )}
        {status === 'error' && (
          <>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚠</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>
              Missing payment reference
            </div>
            <p style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 8 }}>
              We couldn&apos;t find a payment reference in the link. If you were charged, check the
              Billing page — it may already be reflected.
            </p>
            <div style={{ marginTop: 18 }}>
              <Button onClick={goToBilling}>Go to Billing</Button>
            </div>
          </>
        )}
      </Card>
    </PageShell>
  );
}
