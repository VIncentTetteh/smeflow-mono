/**
 * Normalizes a Ghana phone number to E.164 format (+233XXXXXXXXX).
 * Handles: +233244123456, 0244123456, 244123456, 233244123456
 * Returns null if the input cannot be normalized to a valid 9-digit local number.
 */
export function normalizeGhanaPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('233')
    ? digits.slice(3)
    : digits.replace(/^0/, '');
  if (local.length !== 9) return null;
  return `+233${local}`;
}

export function isValidGhanaPhone(value: string): boolean {
  return normalizeGhanaPhone(value) !== null;
}
