'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronDown } from 'lucide-react';

const QA = [
  {
    q: 'Do I need the internet to use SMEflow?',
    a: 'No. The point of sale works offline — sales, stock, and receipts are recorded on your phone and sync automatically once you\'re back on Wi-Fi or mobile data.',
  },
  {
    q: 'What if I don\'t speak English well?',
    a: 'Yensem, the AI assistant, understands Twi and Pidgin as well as English on the Starter and Pro plans, by voice or text.',
  },
  {
    q: 'Which mobile money networks work with SMEflow?',
    a: 'MTN, Telecel, and AirtelTigo via MoMo RequestToPay, plus GhQR — customers pay you directly, on any of these networks.',
  },
  {
    q: 'Is my money safe with SMEflow?',
    a: 'SMEflow never holds your money. Payments go straight to your MoMo wallet or bank account — SMEflow just keeps the books.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Yes. Upgrade, downgrade, or cancel anytime from inside the app — there\'s no lock-in.',
  },
  {
    q: 'Do I need a smartphone?',
    a: 'Yes, an Android phone or iPhone. A low-cost Android device is enough to run SMEflow smoothly.',
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <section id="faq" className="sf-container" style={{ paddingTop: 64, paddingBottom: 72 }}>
      <div style={{ maxWidth: 560, marginBottom: 32 }}>
        <span className="sf-eyebrow">Questions</span>
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
          Before you ask.
        </h2>
      </div>

      <div style={{ maxWidth: 720 }}>
        {QA.map((item, i) => {
          const isOpen = open === i;
          return (
            <div
              key={item.q}
              style={{ borderTop: i === 0 ? '1px solid var(--sf-line)' : undefined, borderBottom: '1px solid var(--sf-line)' }}
            >
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 16,
                  padding: '18px 4px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: 15.5, fontWeight: 600, color: 'var(--ink)' }}>
                  {item.q}
                </span>
                <motion.span
                  animate={{ rotate: isOpen ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  style={{ flexShrink: 0, display: 'flex' }}
                >
                  <ChevronDown size={18} color="var(--ink-3)" />
                </motion.span>
              </button>
              <motion.div
                initial={false}
                animate={{ height: isOpen ? 'auto' : 0, opacity: isOpen ? 1 : 0 }}
                transition={{ duration: 0.2 }}
                style={{ overflow: 'hidden' }}
              >
                <p style={{ fontSize: 14, lineHeight: 1.65, color: 'var(--ink-3)', padding: '0 4px 18px' }}>
                  {item.a}
                </p>
              </motion.div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
