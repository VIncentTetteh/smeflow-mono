'use client';

import { motion } from 'framer-motion';

export function FinalCTA() {
  return (
    <section style={{ background: '#13100c', color: '#f5efe1', padding: '80px 0' }}>
      <motion.div
        className="sf-container"
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        style={{ textAlign: 'center', maxWidth: 620, margin: '0 auto' }}
      >
        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 'clamp(28px, 4vw, 42px)',
            letterSpacing: '-0.02em',
            marginBottom: 16,
          }}
        >
          Start counting the easy way.
        </h2>
        <p style={{ fontSize: 15.5, color: 'rgba(245,239,225,0.6)', marginBottom: 32 }}>
          Free for solo traders. No card required to start.
        </p>
        <a
          href="#pricing"
          style={{
            display: 'inline-flex',
            height: 48,
            padding: '0 26px',
            borderRadius: 10,
            background: 'var(--gold-2)',
            color: '#1a1612',
            alignItems: 'center',
            fontSize: 15,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          Get the app
        </a>
      </motion.div>
    </section>
  );
}
