'use client';

import { motion } from 'framer-motion';
import { TallyReceipt } from './TallyReceipt';

const STATS: Array<[string, string]> = [
  ['GH₵0', 'to start'],
  ['3', 'languages'],
  ['0', 'signal required'],
];

export function Hero() {
  return (
    <section className="sf-container" style={{ paddingTop: 64, paddingBottom: 72 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.1fr 0.9fr',
          gap: 56,
          alignItems: 'center',
        }}
        className="sf-hero-grid"
      >
        <div>
          <motion.span
            className="sf-eyebrow"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            The ledger, digitized
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.08 }}
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 'clamp(34px, 5vw, 56px)',
              lineHeight: 1.08,
              letterSpacing: '-0.025em',
              color: 'var(--ink)',
              marginTop: 16,
              marginBottom: 18,
              maxWidth: 560,
            }}
          >
            Close the exercise book. Run your business from your phone.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.16 }}
            style={{ fontSize: 17, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 480, marginBottom: 30 }}
          >
            SMEflow rings up sales, tracks stock, takes MoMo and GhQR, and lets Yensem — your AI
            assistant — handle the numbers in English, Twi, or Pidgin. Free for solo traders.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.24 }}
            style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 40 }}
          >
            <a
              href="#pricing"
              style={{
                height: 46,
                padding: '0 22px',
                borderRadius: 10,
                background: 'var(--ink)',
                color: '#f5efe1',
                display: 'flex',
                alignItems: 'center',
                fontSize: 14.5,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              Get the app
            </a>
            <a
              href="#features"
              style={{
                height: 46,
                padding: '0 22px',
                borderRadius: 10,
                border: '1px solid var(--sf-line-2)',
                color: 'var(--ink)',
                display: 'flex',
                alignItems: 'center',
                fontSize: 14.5,
                fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              See how it works
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.32 }}
            style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}
          >
            {STATS.map(([n, label]) => (
              <div key={label}>
                <div
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontWeight: 700,
                    fontSize: 22,
                    color: 'var(--ink)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {n}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                  {label}
                </div>
              </div>
            ))}
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20, rotate: -1 }}
          animate={{ opacity: 1, y: 0, rotate: -2 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          <TallyReceipt />
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .sf-hero-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
