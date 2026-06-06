import type { CartLine, LocalItem, SaleDraft } from './localData';
import { normalizeGhanaPhone } from '@/lib/phone';

export type SellMode = SaleDraft['paymentMethod'] | 'ghqr';
export type QuantityChangeReason = 'ok' | 'not-found' | 'out-of-stock' | 'stock-limit';

export function findItemByBarcode(items: LocalItem[], barcode: string) {
  const normalized = barcode.trim().toLowerCase();
  if (!normalized) return undefined;
  return items.find((item) => item.barcode?.trim().toLowerCase() === normalized);
}

export function nextCartForQuantityChange(
  current: CartLine[],
  items: LocalItem[],
  itemId: string,
  delta: number
): { cart: CartLine[]; reason: QuantityChangeReason } {
  const inCart = current.find((line) => line.item.id === itemId);
  const item = inCart?.item ?? items.find((candidate) => candidate.id === itemId);
  if (!item) return { cart: current, reason: 'not-found' };

  const currentQty = inCart?.qty ?? 0;
  const requestedQty = currentQty + delta;

  if (requestedQty <= 0) {
    return { cart: current.filter((line) => line.item.id !== itemId), reason: 'ok' };
  }
  if (item.stockQty <= 0) {
    return { cart: current, reason: 'out-of-stock' };
  }

  const nextQty = Math.min(requestedQty, item.stockQty);
  const reason: QuantityChangeReason = requestedQty > item.stockQty ? 'stock-limit' : 'ok';
  const nextLine = { item, qty: nextQty };

  if (!inCart) {
    return { cart: [...current, nextLine], reason };
  }
  return {
    cart: current.map((line) => line.item.id === itemId ? nextLine : line),
    reason,
  };
}

export function buildSaleDraft({
  customerName,
  customerPhone,
  mode,
  paymentProvider,
  creditDueDate,
  reminderConsent,
  reminderChannel,
}: {
  customerName?: string | null;
  customerPhone?: string | null;
  mode: SellMode;
  paymentProvider?: 'mtn' | 'telecel' | 'vodafone' | 'airteltigo' | null;
  creditDueDate?: string | null;
  reminderConsent?: boolean;
  reminderChannel?: 'whatsapp' | 'sms' | null;
}): SaleDraft {
  const name = customerName?.trim() || undefined;
  const normalizedPhone = customerPhone ? normalizeGhanaPhone(customerPhone) : undefined;

  if (mode === 'momo' || mode === 'mixed') {
    throw new Error('Direct MoMo RequestToPay is retired. Use Paystack.');
  }
  if (mode === 'credit' && !name) {
    throw new Error('Customer name is required for credit sales.');
  }
  if (mode === 'credit' && !normalizedPhone) {
    throw new Error('A valid Ghana phone number is required for credit sales.');
  }
  if (mode === 'credit' && (!creditDueDate || new Date(`${creditDueDate}T00:00:00`).getTime() <= new Date().setHours(0, 0, 0, 0))) {
    throw new Error('Choose a credit due date starting tomorrow.');
  }

  if (mode === 'cash') {
    return { customerName: name, customerPhone: normalizedPhone, paymentMethod: 'cash' };
  }
  if (mode === 'paystack') {
    return { customerName: name, customerPhone: normalizedPhone, paymentMethod: 'paystack' };
  }
  if (mode === 'credit') {
    return {
      customerName: name,
      customerPhone: normalizedPhone,
      creditDueDate,
      reminderConsent,
      reminderChannel: reminderConsent ? reminderChannel ?? 'whatsapp' : undefined,
      paymentMethod: 'credit',
    };
  }
  if (mode === 'ghqr') {
    return {
      customerName: name,
      customerPhone: normalizedPhone,
      notes: 'Payment method: GhQR',
      paymentMethod: 'ghqr',
    };
  }

  return { customerName: name, customerPhone: normalizedPhone, paymentMethod: 'cash' };
}
