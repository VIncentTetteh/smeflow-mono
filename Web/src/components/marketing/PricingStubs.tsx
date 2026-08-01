'use client';

import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

const PLANS = [
  {
    name: 'Free',
    price: 'GH₵0',
    period: '/month',
    tagline: 'For solo traders getting started',
    features: [
      'POS with cash, MoMo & GhQR',
      '50 inventory items',
      '50 customer records',
      'Yensem chat in English',
    ],
    featured: false,
  },
  {
    name: 'Starter',
    price: 'GH₵49',
    period: '/month',
    tagline: 'For growing shops that need more',
    features: [
      'Everything in Free, plus:',
      '500 items, 500 customers',
      'Invoicing (20/month)',
      'Yensem in Twi & Pidgin',
      'Credit score & loan offers',
    ],
    featured: true,
  },
  {
    name: 'Pro',
    price: 'GH₵149',
    period: '/month',
    tagline: 'For businesses with staff and compliance needs',
    features: [
      'Everything in Starter, plus:',
      'Unlimited items & invoices',
      'Payroll for up to 5 staff',
      'Direct GRA tax filing',
      'Field agents & bulk payouts',
    ],
    featured: false,
  },
];

export function PricingStubs() {
  return (
    <section id="pricing" className="sf-container" style={{ paddingTop: 64, paddingBottom: 72 }}>
      <div style={{ maxWidth: 560, marginBottom: 40 }}>
        <span className="sf-eyebrow">Pricing</span>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 'clamp(26px, 3.4vw, 36px)',
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            marginTop: 10,
            marginBottom: 10,
          }}
        >
          Generous on the daily tasks. Fair on the rest.
        </h2>
        <p style={{ fontSize: 15, color: 'var(--ink-3)' }}>
          Annual billing saves two months. Cancel or change plans anytime from the app.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }} className="sf-pricing-grid">
        {PLANS.map((plan, i) => (
          <motion.div
            key={plan.name}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            whileHover={{ y: -4 }}
            className="sf-stub"
            style={{
              padding: '28px 24px',
              outline: plan.featured ? '2px solid var(--brand)' : undefined,
              outlineOffset: -2,
            }}
          >
            {plan.featured ? (
              <div
                style={{
                  display: 'inline-block',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--brand)',
                  background: 'var(--brand-soft)',
                  padding: '3px 9px',
                  borderRadius: 999,
                  marginBottom: 14,
                }}
              >
                Most popular
              </div>
            ) : (
              <div style={{ height: 10, marginBottom: 14 }} />
            )}

            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 600, color: 'var(--ink)' }}>
              {plan.name}
            </h3>
            <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 18 }}>
              {plan.tagline}
            </p>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 20 }}>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  fontSize: 32,
                  color: 'var(--ink)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {plan.price}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{plan.period}</span>
            </div>

            <div style={{ borderTop: '1px dashed var(--sf-line)', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plan.features.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <Check size={14} color="var(--brand)" style={{ marginTop: 3, flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
            </div>

            <a
              href="#"
              style={{
                marginTop: 24,
                display: 'block',
                textAlign: 'center',
                height: 42,
                lineHeight: '42px',
                borderRadius: 9,
                background: plan.featured ? 'var(--ink)' : 'var(--sf-sunken)',
                color: plan.featured ? '#f5efe1' : 'var(--ink)',
                fontSize: 13.5,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              {plan.name === 'Free' ? 'Start free' : `Choose ${plan.name}`}
            </a>
          </motion.div>
        ))}
      </div>

      <style>{`
        @media (max-width: 860px) {
          .sf-pricing-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
