'use client';

import { motion } from 'framer-motion';

const STEPS = [
  {
    n: '1',
    title: 'Sign up with your phone number',
    body: 'No paperwork, no branch visit. Enter your number, confirm the code, and you\'re in.',
  },
  {
    n: '2',
    title: 'Start selling',
    body: 'Add your first few items and ring up your first sale — most traders are set up in under five minutes.',
  },
  {
    n: '3',
    title: 'Grow as you go',
    body: 'As your sales history builds, unlock invoicing, tax tools, and credit offers tailored to your business.',
  },
];

export function HowItWorks() {
  return (
    <section className="sf-container" style={{ paddingTop: 64, paddingBottom: 64 }}>
      <div style={{ maxWidth: 560, marginBottom: 40 }}>
        <span className="sf-eyebrow">Getting started</span>
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 'clamp(26px, 3.4vw, 36px)',
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            marginTop: 10,
          }}
        >
          Three steps, no forms.
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 28 }} className="sf-steps-grid">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, delay: i * 0.1 }}
          >
            <div
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 600,
                fontSize: 34,
                color: 'var(--gold-2)',
                marginBottom: 12,
              }}
            >
              {step.n}
            </div>
            <h3
              style={{ fontSize: 16.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 8 }}
            >
              {step.title}
            </h3>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-3)' }}>
              {step.body}
            </p>
          </motion.div>
        ))}
      </div>

      <style>{`
        @media (max-width: 760px) {
          .sf-steps-grid {
            grid-template-columns: 1fr !important;
            gap: 32px !important;
          }
        }
      `}</style>
    </section>
  );
}
