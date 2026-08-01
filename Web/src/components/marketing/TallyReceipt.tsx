'use client';

import { motion } from 'framer-motion';

const STROKE_DELAYS = [0, 0.22, 0.44, 0.66];

/**
 * The page's signature moment: four tally strokes (the way a trader marks
 * sales in an exercise book) draw in, a fifth strikes through them, and the
 * running total resolves into a clean digital figure.
 */
export function TallyReceipt() {
  return (
    <div
      style={{
        background: 'var(--sf-surface)',
        border: '1px solid var(--sf-line)',
        borderRadius: 18,
        padding: '26px 24px',
        boxShadow: '0 24px 48px -20px rgba(26, 22, 18, 0.22)',
        width: '100%',
        maxWidth: 320,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <span className="sf-eyebrow">Today&apos;s sales</span>
        <span className="sf-ledger-index">GH₵</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 20 }}>
        <svg width="92" height="48" viewBox="0 0 92 48" fill="none" aria-hidden="true">
          {STROKE_DELAYS.map((delay, i) => (
            <motion.line
              key={i}
              x1={8 + i * 20}
              y1="4"
              x2={8 + i * 20}
              y2="44"
              stroke="var(--ink-3)"
              strokeWidth="3"
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              whileInView={{ pathLength: 1, opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay, ease: 'easeOut' }}
            />
          ))}
          <motion.line
            x1="4"
            y1="40"
            x2="72"
            y2="10"
            stroke="var(--danger)"
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.3, delay: 0.92, ease: 'easeOut' }}
          />
        </svg>
        <motion.span
          initial={{ opacity: 0, y: 6 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.3, delay: 1.2 }}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--ink-3)' }}
        >
          → 5 sales
        </motion.span>
      </div>

      <div style={{ borderTop: '1px dashed var(--sf-line)', paddingTop: 16 }}>
        {[
          ['Cash', 'GH₵140.00'],
          ['MoMo · MTN', 'GH₵286.50'],
          ['GhQR', 'GH₵92.00'],
        ].map(([label, value]) => (
          <div
            key={label}
            style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}
          >
            <span style={{ color: 'var(--ink-3)' }}>{label}</span>
            <span
              style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--ink)' }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          borderTop: '1px solid var(--sf-line)',
          marginTop: 10,
          paddingTop: 10,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--ink)' }}>Total</span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            fontSize: 16,
            color: 'var(--ink)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          GH₵518.50
        </span>
      </div>
    </div>
  );
}
