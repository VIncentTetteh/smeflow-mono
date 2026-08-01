'use client';

import { motion } from 'framer-motion';

const PHRASES = [
  { lang: 'English', text: '"Record a sale — two bags of rice, cash."' },
  { lang: 'Twi', text: '"Kyerɛw adetɔn — mpaboa mmienu, sika."' },
  { lang: 'Pidgin', text: '"Check how much stock dey remain for sugar."' },
];

export function YensemSpotlight() {
  return (
    <section style={{ background: '#13100c', color: '#f5efe1', padding: '72px 0' }}>
      <div
        className="sf-container sf-yensem-grid"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}
      >
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11.5,
              fontWeight: 600,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--gold)',
            }}
          >
            Meet Yensem
          </span>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 600,
              fontSize: 'clamp(26px, 3.4vw, 36px)',
              letterSpacing: '-0.02em',
              marginTop: 12,
              marginBottom: 16,
            }}
          >
            Talk to your books like you&apos;d talk to your books.
          </h2>
          <p style={{ fontSize: 15.5, lineHeight: 1.65, color: 'rgba(245,239,225,0.65)', maxWidth: 440 }}>
            Yensem is SMEflow&apos;s AI assistant — it understands English, Twi, and Pidgin, by voice or
            text. Ask it to record a sale, check what&apos;s low on stock, or explain this week&apos;s
            numbers, the same way you&apos;d ask a person at the counter.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          {PHRASES.map((p, i) => (
            <motion.div
              key={p.lang}
              initial={{ opacity: 0, x: 12 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.35, delay: 0.15 + i * 0.08 }}
              style={{
                background: 'rgba(245,239,225,0.06)',
                border: '1px solid rgba(245,239,225,0.12)',
                borderRadius: 12,
                padding: '14px 16px',
              }}
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'var(--gold)',
                  marginBottom: 6,
                }}
              >
                {p.lang}
              </div>
              <div style={{ fontSize: 14.5, color: 'rgba(245,239,225,0.85)' }}>{p.text}</div>
            </motion.div>
          ))}
        </motion.div>
      </div>

      <style>{`
        @media (max-width: 760px) {
          .sf-yensem-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
