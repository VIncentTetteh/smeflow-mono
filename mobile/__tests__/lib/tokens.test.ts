import { colors, fonts, spacing, radii } from '@/lib/tokens';

describe('tokens', () => {
  it('exports required color keys', () => {
    expect(colors.ink).toBe('#2a2a22');
    expect(colors.brand).toBe('#1f6a4f');
    expect(colors.gold).toBe('#e8c25a');
    expect(colors.danger).toBe('#d03514');
    expect(colors.info).toBe('#5b6be5');
    expect(colors.bg).toBe('#faf8f3');
  });

  it('exports dark theme overrides', () => {
    expect(colors.dark.bg).toBe('#1a1a14');
    expect(colors.dark.surface).toBe('#252520');
  });

  it('exports spacing scale', () => {
    expect(spacing.md).toBe(16);
    expect(spacing.lg).toBe(24);
  });
});
