import { normalizeGhanaPhone, isValidGhanaPhone } from '../../src/lib/phone';

describe('normalizeGhanaPhone', () => {
  it('handles 0-prefixed numbers', () => {
    expect(normalizeGhanaPhone('0244123456')).toBe('+233244123456');
  });
  it('handles +233 prefix', () => {
    expect(normalizeGhanaPhone('+233244123456')).toBe('+233244123456');
  });
  it('handles 233 prefix without +', () => {
    expect(normalizeGhanaPhone('233244123456')).toBe('+233244123456');
  });
  it('handles bare 9 digits', () => {
    expect(normalizeGhanaPhone('244123456')).toBe('+233244123456');
  });
  it('returns null for short numbers', () => {
    expect(normalizeGhanaPhone('0244')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(normalizeGhanaPhone('')).toBeNull();
  });
  it('returns null for 8 digit local number', () => {
    expect(normalizeGhanaPhone('24412345')).toBeNull();
  });
  it('returns null for 10 digit local number', () => {
    expect(normalizeGhanaPhone('2441234567')).toBeNull();
  });
});

describe('isValidGhanaPhone', () => {
  it('returns true for valid number', () => {
    expect(isValidGhanaPhone('0244123456')).toBe(true);
  });
  it('returns false for invalid number', () => {
    expect(isValidGhanaPhone('0244')).toBe(false);
  });
});
