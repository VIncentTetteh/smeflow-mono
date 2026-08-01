'use client';
import {
  usePlans,
  useSubscription,
  useBillingTransactions,
  useSubscribe,
  useChangePlan,
  useCancelSubscription,
} from '@/hooks/store/useStoreBilling';
import { useIsOwner } from '@/hooks/store/useRole';
import { PageShell, Card, Button, Badge, EmptyState, Spinner, Table, ghs } from '@/components/store/kit';
import { toast } from 'sonner';

export default function BillingPage() {
  const isOwner = useIsOwner();
  const { data: plans, isLoading: plansLoading } = usePlans();
  const { data: sub } = useSubscription();
  const { data: txns } = useBillingTransactions();
  const subscribe = useSubscribe();
  const changePlan = useChangePlan();
  const cancel = useCancelSubscription();

  const currentPlan = sub?.plan ?? 'free';

  const onSelectPlan = async (planName: string) => {
    if (planName === currentPlan) return;
    if (planName === 'free') {
      if (!confirm('Downgrade to the free plan?')) return;
      await changePlan.mutateAsync({ plan: 'free' });
      toast.success('Switched to free plan');
      return;
    }
    // Paid plan → hosted Paystack payment page.
    const res = await subscribe.mutateAsync({ plan: planName });
    if (res.payment_url) {
      window.location.href = res.payment_url;
    } else {
      toast.success('Subscription updated');
    }
  };

  return (
    <PageShell title="Billing" subtitle="Your plan, payments, and invoices">
      {/* Current subscription */}
      <Card style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Current plan
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--ink)', textTransform: 'capitalize' }}>
                {currentPlan}
              </span>
              {sub && <Badge tone={sub.status === 'active' ? 'success' : 'warn'}>{sub.status}</Badge>}
              {sub?.cancel_at_period_end && <Badge tone="danger">cancels at period end</Badge>}
            </div>
            {sub?.current_period_end && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }}>
                Renews {new Date(sub.current_period_end).toLocaleDateString()}
              </div>
            )}
          </div>
          {isOwner && sub && currentPlan !== 'free' && !sub.cancel_at_period_end && (
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Cancel your subscription at the end of the billing period?')) {
                  cancel.mutate(undefined, { onSuccess: () => toast.success('Cancellation scheduled') });
                }
              }}
            >
              Cancel subscription
            </Button>
          )}
        </div>
      </Card>

      {/* Plans */}
      {plansLoading ? (
        <Spinner />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 14,
            marginBottom: 24,
          }}
        >
          {(plans ?? []).map((p) => {
            const isCurrent = p.name === currentPlan;
            return (
              <Card key={p.name} style={{ border: isCurrent ? '1.5px solid var(--brand)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 700, color: 'var(--ink)', textTransform: 'capitalize' }}>
                    {p.name}
                  </span>
                  {isCurrent && <Badge tone="brand">current</Badge>}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)', marginBottom: 12 }}>
                  {Number(p.price) === 0 ? 'Free' : ghs(p.price)}
                  {Number(p.price) > 0 && <span style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}> /mo</span>}
                </div>
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {(p.features ?? []).slice(0, 6).map((f, i) => (
                    <li key={i} style={{ fontSize: 12.5, color: 'var(--ink-2)', display: 'flex', gap: 8 }}>
                      <span style={{ color: 'var(--success)' }}>✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                {isOwner ? (
                  <Button
                    variant={isCurrent ? 'ghost' : 'primary'}
                    disabled={isCurrent || subscribe.isPending || changePlan.isPending}
                    onClick={() => onSelectPlan(p.name)}
                  >
                    {isCurrent ? 'Your plan' : Number(p.price) === 0 ? 'Downgrade' : 'Upgrade'}
                  </Button>
                ) : (
                  <p style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Only the owner can change the plan.</p>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Transactions */}
      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink-2)', marginBottom: 10 }}>Payment history</div>
      {!txns || txns.items.length === 0 ? (
        <EmptyState title="No transactions yet" />
      ) : (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <Table
            head={['Date', 'Description', 'Method', 'Amount', 'Status']}
            rows={txns.items.map((t) => [
              new Date(t.created_at).toLocaleDateString(),
              t.description ?? '—',
              t.payment_method ?? '—',
              <span key="a" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                {ghs(t.amount)}
              </span>,
              <Badge key="s" tone={t.status === 'success' || t.status === 'paid' ? 'success' : 'default'}>
                {t.status}
              </Badge>,
            ])}
          />
        </Card>
      )}
    </PageShell>
  );
}
