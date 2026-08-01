'use client';

import { motion } from 'framer-motion';

const ENTRIES = [
  {
    index: '§01',
    title: 'Point of sale',
    body: 'Ring up a sale in one tap. Take cash, MoMo RequestToPay, or scan a GhQR code — it keeps working when the network doesn\'t.',
  },
  {
    index: '§02',
    title: 'Inventory',
    body: 'Know what\'s on the shelf. Track stock as you sell, and get a low-stock alert before you run out.',
  },
  {
    index: '§03',
    title: 'Yensem, your AI assistant',
    body: 'Tell Yensem to record a sale or check stock — by voice or text, in English, Twi, or Pidgin.',
  },
  {
    index: '§04',
    title: 'Analytics',
    body: 'See which items sell, how much came in as cash versus MoMo, and how this week compares to last.',
  },
  {
    index: '§05',
    title: 'Invoicing & tax',
    body: 'Send an invoice over WhatsApp or SMS. Track VAT deadlines, and file with GRA directly on Pro.',
  },
  {
    index: '§06',
    title: 'Credit',
    body: 'Build a credit score from your own sales history, and see pre-approved loan offers you can act on.',
  },
];

export function FeatureLedger() {
  return (
    <section id="features" className="sf-container" style={{ paddingTop: 64, paddingBottom: 64 }}>
      <div style={{ maxWidth: 560, marginBottom: 40 }}>
        <span className="sf-eyebrow">What&apos;s in the book</span>
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
          Every page of the ledger, in one app.
        </h2>
      </div>

      <div>
        {ENTRIES.map((entry, i) => (
          <motion.div
            key={entry.index}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, delay: (i % 3) * 0.06 }}
            className="sf-margin-rule sf-line"
            style={{
              borderTop: i === 0 ? '1px solid var(--sf-line)' : undefined,
              borderBottom: '1px solid var(--sf-line)',
              padding: '22px 0 22px 20px',
              display: 'grid',
              gridTemplateColumns: '64px 1fr',
              gap: 20,
              alignItems: 'baseline',
            }}
          >
            <span className="sf-ledger-index">{entry.index}</span>
            <div>
              <h3
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 600,
                  fontSize: 19,
                  color: 'var(--ink)',
                  marginBottom: 6,
                }}
              >
                {entry.title}
              </h3>
              <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 560 }}>
                {entry.body}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
