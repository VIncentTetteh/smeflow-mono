import type { AxiosError } from 'axios';
import { createPaystackSaleIntent, recordSale, verifyPaystackSaleIntent as verifyPaystackIntentApi } from '@/api/sales.api';
import { syncNow } from '@/db/sync/service';
import {
  type CartLine,
  type SaleDraft,
  recordOfflineSale,
} from '@/features/localData';
import { queryClient } from '@/api/queryClient';
import { MOBILE_ANALYTICS_EVENTS, trackEvent } from '@/lib/analytics';
import { useUIStore } from '@/store/ui';

export interface OnlineSalePayload {
  client_created_at: string;
  customer_name?: string;
  customer_phone?: string;
  credit_due_date?: string;
  reminder_consent?: boolean;
  reminder_channel?: 'whatsapp' | 'sms';
  discount_amount: string;
  idempotency_key: string;
  items: Array<{
    description?: string;
    discount: string;
    item_id?: string;
    qty: number;
    unit_price: string;
  }>;
  payment_method: SaleDraft['paymentMethod'];
  payment_provider?: NonNullable<SaleDraft['paymentProvider']>;
  payment_splits?: Array<{
    method: 'cash' | 'momo';
    amount: string;
    phone?: string;
  }>;
  notes?: string;
}

export interface OnlineFirstSaleResult {
  balanceDue: number;
  idempotencyKey: string;
  invoiceId?: string | null;
  mode: 'online' | 'offline';
  paymentRequestId?: string | null;
  saleId: string;
  total: number;
}

export interface PaystackSaleIntentResult {
  expiresAt?: string | null;
  externalRef?: string | null;
  invoiceId?: string | null;
  paymentId: string;
  providerMessage?: string | null;
  saleId?: string | null;
  status: string;
  total: number;
  paymentUrl?: string | null;
  qrImageUrl?: string | null;
  channel?: string | null;
  providerDetail?: string | null;
}

function newIdempotencyKey() {
  return `sale-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildOnlineSalePayload(
  cart: CartLine[],
  draft: SaleDraft,
  idempotencyKey = newIdempotencyKey()
): OnlineSalePayload {
  return {
    client_created_at: new Date().toISOString(),
    customer_name: draft.customerName?.trim() || undefined,
    customer_phone: draft.customerPhone?.trim() || undefined,
    credit_due_date: draft.creditDueDate || undefined,
    reminder_consent: draft.reminderConsent || undefined,
    reminder_channel: draft.reminderConsent ? draft.reminderChannel ?? 'whatsapp' : undefined,
    discount_amount: '0.00',
    idempotency_key: idempotencyKey,
    items: cart.map((line) => ({
      description: line.item.serverId ? undefined : line.item.name,
      discount: '0.00',
      item_id: line.item.serverId ?? undefined,
      qty: line.qty,
      unit_price: (line.unitPrice ?? line.item.sellPrice).toFixed(2),
    })),
    payment_method: draft.paymentMethod,
    payment_provider: draft.paymentProvider ?? undefined,
    payment_splits: draft.paymentSplits?.map((s) => ({
      method: s.method,
      amount: s.amount.toFixed(2),
      phone: s.phone,
    })),
    notes: draft.notes?.trim() || undefined,
  };
}

function looksNetworkRelated(error: unknown) {
  const axiosError = error as AxiosError | undefined;
  // A response with any HTTP status code means the server was reached — surface it, don't queue offline
  if (axiosError?.response) return false;
  return (
    axiosError?.code === 'ECONNABORTED' ||
    axiosError?.code === 'ECONNREFUSED' ||
    axiosError?.code === 'ERR_NETWORK' ||
    !axiosError?.code  // no code at all = no response received
  );
}

function paidAmount(cart: CartLine[], draft: SaleDraft) {
  const total = cart.reduce((sum, line) => sum + (line.unitPrice ?? line.item.sellPrice) * line.qty, 0);
  if (draft.paymentMethod === 'cash') return total;
  if (draft.paymentMethod === 'mixed') {
    return (draft.paymentSplits ?? [])
      .filter((split) => split.method === 'cash')
      .reduce((sum, split) => sum + split.amount, 0);
  }
  return 0;
}

export async function recordSaleOnlineFirst(
  cart: CartLine[],
  draft: SaleDraft
): Promise<OnlineFirstSaleResult> {
  const idempotencyKey = newIdempotencyKey();

  if (draft.paymentMethod === 'momo') {
    throw new Error('MoMo sales must use the verified Paystack prompt flow.');
  }
  if (draft.paymentMethod === 'paystack') {
    throw new Error('Paystack sales must use the verified Paystack payment flow.');
  }

  // Skip API call entirely when device is known to be offline
  if (useUIStore.getState().isOffline) {
    const queued = await recordOfflineSale(cart, draft);
    const paid = paidAmount(cart, draft);
    trackEvent(MOBILE_ANALYTICS_EVENTS.FIRST_SALE_RECORDED, {
      mode: 'offline',
      paymentMethod: draft.paymentMethod,
      total: queued.total,
    });
    return {
      balanceDue: Math.max(0, queued.total - paid),
      idempotencyKey: queued.idempotencyKey,
      mode: 'offline',
      saleId: queued.id,
      total: queued.total,
    };
  }

  try {
    if (cart.some((line) => !line.item.serverId)) {
      throw new Error('Unsynced local inventory must be queued before online sale recording.');
    }

    const data = await recordSale(buildOnlineSalePayload(cart, draft, idempotencyKey));

    void syncNow();
    void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
    void queryClient.invalidateQueries({ queryKey: ['sales-daily-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics-summary'] });
    void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    void queryClient.invalidateQueries({ queryKey: ['tax-workspace'] });
    // Keep a delayed refresh for any invoice assets that finish shortly after the receipt row is created.
    setTimeout(() => {
      void queryClient.invalidateQueries({ queryKey: ['invoices'] });
    }, 3500);

    trackEvent(MOBILE_ANALYTICS_EVENTS.FIRST_SALE_RECORDED, {
      mode: 'online',
      paymentMethod: draft.paymentMethod,
      total: Number(data.total ?? 0),
    });

    return {
      balanceDue: Number(data.balance_due ?? 0),
      idempotencyKey,
      invoiceId: data.invoice_id ?? null,
      mode: 'online',
      paymentRequestId: data.payment_request_id ?? null,
      saleId: String(data.sale_id),
      total: Number(data.total ?? 0),
    };
  } catch (error) {
    if (!looksNetworkRelated(error) && cart.every((line) => line.item.serverId)) {
      throw error;
    }

    const queued = await recordOfflineSale(cart, draft);
    const paid = paidAmount(cart, draft);
    trackEvent(MOBILE_ANALYTICS_EVENTS.FIRST_SALE_RECORDED, {
      mode: 'offline',
      paymentMethod: draft.paymentMethod,
      total: queued.total,
    });
    return {
      balanceDue: Math.max(0, queued.total - paid),
      idempotencyKey: queued.idempotencyKey,
      mode: 'offline',
      saleId: queued.id,
      total: queued.total,
    };
  }
}

function mapPaymentIntent(data: Awaited<ReturnType<typeof createPaystackSaleIntent>>): PaystackSaleIntentResult {
  return {
    expiresAt: data.expires_at ?? null,
    externalRef: data.external_ref ?? null,
    invoiceId: data.invoice_id ?? null,
    paymentId: String(data.payment_id),
    providerMessage: data.provider_message ?? null,
    saleId: data.sale_id ? String(data.sale_id) : null,
    status: data.status,
    total: Number(data.total ?? 0),
    paymentUrl: data.payment_url ?? null,
    qrImageUrl: data.qr_image_url ?? null,
    channel: data.channel ?? null,
    providerDetail: data.provider_detail ?? null,
  };
}

export async function createPaystackSaleIntentFromCart(
  cart: CartLine[],
  draft: SaleDraft
): Promise<PaystackSaleIntentResult> {
  if (draft.paymentMethod !== 'paystack') throw new Error('Paystack intent requires a Paystack sale draft.');
  if (useUIStore.getState().isOffline) throw new Error('Paystack payment needs an internet connection.');
  if (cart.some((line) => !line.item.serverId)) throw new Error('Sync inventory before taking Paystack payment.');
  const data = await createPaystackSaleIntent(buildOnlineSalePayload(cart, draft));
  return mapPaymentIntent(data);
}

export async function verifyPaystackSaleIntent(paymentId: string): Promise<PaystackSaleIntentResult> {
  const data = await verifyPaystackIntentApi(paymentId);
  if (data.sale_id) {
    void syncNow();
    void queryClient.invalidateQueries({ queryKey: ['payments-workspace'] });
    void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
    void queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
  }
  return mapPaymentIntent(data);
}
