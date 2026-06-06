import { apiClient } from '@/lib/api';

export type PageResult<T> = {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
};

export type AdminKpis = {
  total_businesses: number;
  active_businesses: number;
  active_subscriptions: number;
  suspended_businesses: number;
  total_users: number;
  total_sales: number;
  tpv_ghs: number;
  subscription_revenue_ghs: number;
  total_disbursed: number;
  loan_disbursement_ghs: number;
  pending_kyc: number;
  reviewing_kyc: number;
  verified_kyc: number;
  failed_kyc: number;
};

export type AdminBusiness = {
  id: string;
  name: string;
  type: string;
  subscription: string | null;
  is_active: boolean;
  created_at: string;
};

export type AdminBusinessDetail = AdminBusiness & {
  tin?: string | null;
  kyc_status: string | null;
  owner_name?: string | null;
  phone?: string | null;
  region?: string | null;
  members?: Array<{ user_id: string; role: string; is_active: boolean; joined_at: string }>;
  billing?: { plan: string | null; status: string; current_period_end: string | null };
  sales?: { count: number; tpv_ghs: number };
};

export type AdminAuditLog = {
  id: string;
  created_at: string;
  actor_email: string | null;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string | null;
  success: boolean;
  business_id?: string | null;
};

export type FraudSignal = {
  business_id: string;
  business_name: string;
  signal: string;
  detail: string;
  severity: 'high' | 'med' | 'low';
  flagged_at: string;
  transaction_count?: number;
  tpv_ghs?: number;
  reason?: string;
};

export type SyncQueueItem = {
  id: string;
  business_name: string;
  sales_count: number;
  total_amount: number;
  queued_at: string | null;
  status: string;
};

export type SettlementItem = {
  ref: string;
  provider: string;
  amount: number;
  businesses: number;
  status: string;
  settled_at: string;
};

export type AdminLoan = {
  id: string;
  business_id: string;
  amount_requested: number;
  amount_approved: number | null;
  lender_id: string | null;
  status: string;
  created_at: string;
  reason?: string | null;
  decided_at?: string | null;
};

export type PendingAction = {
  id: string;
  action_type: string;
  payload: Record<string, unknown>;
  requested_by: string;
  approved_by: string | null;
  status: string;
  created_at: string;
  expires_at: string;
  approved_at: string | null;
};

export type TransactionItem = {
  id: string;
  business_id: string;
  customer_id: string | null;
  status: string;
  payment_method: string | null;
  total: number;
  amount_paid: number;
  balance_due: number;
  created_at: string;
};

export type AppealItem = {
  id: string;
  business_id: string;
  submitted_by: string;
  reason: string;
  evidence_url?: string | null;
  status: string;
  review_reason?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  created_at: string;
};

export type LenderRevenueItem = {
  id: string;
  loan_request_id: string;
  business_id: string;
  lender_id: string;
  principal_amount: number;
  fee_rate_percent: number;
  fee_amount: number;
  status: string;
  provider_ref: string | null;
  earned_at: string;
  paid_at: string | null;
};

export type DvaPaymentItem = {
  id: string;
  business_id: string;
  business_name: string;
  amount: number;
  status: string;
  channel: string | null;
  external_ref: string | null;
  created_at: string;
  confirmed_at: string | null;
};

function asPage<T>(data: PageResult<T> | T[]): PageResult<T> {
  if (Array.isArray(data)) return { items: data, total: data.length };
  return { items: data.items ?? [], total: data.total ?? 0, limit: data.limit, offset: data.offset };
}

export function getApiErrorMessage(error: unknown, fallback = 'Request failed. Please try again.') {
  const detail = (error as { response?: { data?: { detail?: unknown; error?: { message?: string } } } })?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? String(d)).join(', ');
  const message = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
  return message ?? fallback;
}

export async function fetchAdminKpis() {
  const res = await apiClient.get('/admin/analytics/kpis');
  const data = res.data as Partial<AdminKpis>;
  return {
    total_businesses: Number(data.total_businesses ?? 0),
    active_businesses: Number(data.active_businesses ?? data.active_subscriptions ?? 0),
    active_subscriptions: Number(data.active_subscriptions ?? data.active_businesses ?? 0),
    suspended_businesses: Number(data.suspended_businesses ?? 0),
    total_users: Number(data.total_users ?? 0),
    total_sales: Number(data.total_sales ?? 0),
    tpv_ghs: Number(data.tpv_ghs ?? 0),
    subscription_revenue_ghs: Number(data.subscription_revenue_ghs ?? 0),
    total_disbursed: Number(data.total_disbursed ?? data.loan_disbursement_ghs ?? 0),
    loan_disbursement_ghs: Number(data.loan_disbursement_ghs ?? data.total_disbursed ?? 0),
    pending_kyc: Number(data.pending_kyc ?? 0),
    reviewing_kyc: Number(data.reviewing_kyc ?? 0),
    verified_kyc: Number(data.verified_kyc ?? 0),
    failed_kyc: Number(data.failed_kyc ?? 0),
  } satisfies AdminKpis;
}

export async function fetchAdminBusinesses(page: number, search: string) {
  const limit = 20;
  const res = await apiClient.get('/admin/businesses', {
    params: { offset: (page - 1) * limit, limit, search: search || undefined },
  });
  return asPage<AdminBusiness>(res.data);
}

export async function fetchAdminBusinessDetail(id: string) {
  const res = await apiClient.get(`/admin/businesses/${id}`);
  return res.data as AdminBusinessDetail;
}

export async function fetchAdminAuditLogs(page = 1, action?: string) {
  const res = await apiClient.get('/admin/audit-logs', {
    params: { offset: (page - 1) * 50, limit: 50, action: action || undefined },
  });
  return asPage<AdminAuditLog>(res.data);
}

export async function fetchFraudSignals() {
  const res = await apiClient.get('/admin/fraud-queue');
  const page = asPage<Record<string, unknown>>(res.data);
  return page.items.map((item) => {
    const transactionCount = Number(item.transaction_count ?? 0);
    const tpv = Number(item.tpv_ghs ?? 0);
    return {
      business_id: String(item.business_id ?? ''),
      business_name: String(item.business_name ?? 'Unknown business'),
      signal: String(item.signal ?? item.reason ?? 'Risk signal'),
      detail: String(item.detail ?? `${transactionCount} transactions · GH₵ ${tpv.toLocaleString()}`),
      severity: (item.severity === 'high' || item.severity === 'med' || item.severity === 'low' ? item.severity : 'med') as FraudSignal['severity'],
      flagged_at: String(item.flagged_at ?? new Date().toISOString()),
      transaction_count: transactionCount,
      tpv_ghs: tpv,
      reason: typeof item.reason === 'string' ? item.reason : undefined,
    };
  });
}

export async function fetchAdminLoans(status?: string, page = 1) {
  const limit = 25;
  const res = await apiClient.get('/admin/loans', {
    params: { status: status || undefined, limit, offset: (page - 1) * limit },
  });
  return asPage<AdminLoan>(res.data);
}

export async function fetchPendingActions(status?: string) {
  const res = await apiClient.get('/admin/pending-actions', { params: { status: status || undefined } });
  return asPage<PendingAction>(res.data);
}

export async function fetchTransactions(page = 1) {
  const res = await apiClient.get('/admin/transactions', { params: { offset: (page - 1) * 50, limit: 50 } });
  return asPage<TransactionItem>(res.data);
}

export async function fetchAppeals(status?: string) {
  const res = await apiClient.get('/admin/appeals', { params: { status: status || undefined } });
  return asPage<AppealItem>(res.data);
}

export async function decideAppeal(appealId: string, action: 'approve' | 'reject', reason?: string, totpCode?: string) {
  const res = await apiClient.post(
    `/admin/appeals/${appealId}/${action}`,
    { reason: reason || null },
    { headers: totpCode ? { 'X-Admin-TOTP': totpCode } : undefined }
  );
  return res.data as { id: string; business_id: string; status: string; review_reason: string | null; reviewed_at: string };
}

export async function fetchLenderRevenue(page = 1, status?: string) {
  const res = await apiClient.get('/admin/lender-revenue', { params: { offset: (page - 1) * 50, limit: 50, status: status || undefined } });
  return asPage<LenderRevenueItem>(res.data);
}

export async function fetchProviderReadiness() {
  const res = await apiClient.get('/admin/provider-readiness');
  return res.data as { status: string; providers: Record<string, { status?: string; missing?: string[]; configured?: string[] }> };
}

export async function fetchDvaPayments(page = 1) {
  const res = await apiClient.get('/admin/payments/dva', { params: { offset: (page - 1) * 50, limit: 50 } });
  return asPage<DvaPaymentItem>(res.data);
}
