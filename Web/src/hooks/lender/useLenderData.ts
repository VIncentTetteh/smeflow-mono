import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export function useLenderDashboard(params?: { from_date?: string; to_date?: string }) {
  return useQuery({
    queryKey: ['lender', 'analytics', params?.from_date ?? null, params?.to_date ?? null],
    queryFn: async () => {
      const res = await apiClient.get('/lender/analytics', {
        params: {
          from_date: params?.from_date || undefined,
          to_date: params?.to_date || undefined,
        },
      });
      return res.data as {
        total_disbursed: number;
        active_loans: number;
        repayment_rate: number;
        overdue_count: number;
        pending_loan_requests: number;
        consented_businesses: number;
        active_products: number;
        total_products: number;
        api_ready: boolean;
        webhook_configured: boolean;
        review_queue: Array<{
          id: string;
          amount_requested: number;
          requested_at: string | null;
        }>;
        monthly_disbursements: Array<{ month: string; amount: number }>;
        portfolio_by_sector: Array<{ sector: string; pct: number; amount: number }>;
        repayment_health: Array<{ label: string; pct: number; tone: string }>;
        monthly_repaid: Array<{ month: string; rate: number }>;
        avg_ticket: number;
        avg_tenor_days: number;
        npl_rate: number;
      };
    },
    refetchInterval: 120_000,
  });
}

export function useLenderLoans(params?: { limit?: number; offset?: number }) {
  return useQuery({
    queryKey: ['lender', 'loans', params?.limit ?? null, params?.offset ?? null],
    queryFn: async () => {
      const res = await apiClient.get('/lender/loans', {
        params: {
          limit: params?.limit,
          offset: params?.offset,
        },
      });
      return res.data as Array<{
        id: string;
        business_ref: string;
        amount_requested: number;
        amount_approved?: number | null;
        term_days?: number | null;
        credit_score: number | null;
        credit_band: string | null;
        status: string;
        requested_at: string;
      }>;
    },
  });
}

export function useLoanInstallments(loanId: string) {
  return useQuery({
    queryKey: ['lender', 'loan-installments', loanId],
    queryFn: async () => {
      const res = await apiClient.get(`/lender/loans/${loanId}/installments`);
      return res.data as Array<{
        id: string;
        due_date: string;
        amount: number;
        status: string;
      }>;
    },
    enabled: !!loanId,
  });
}

export function useLenderBusinesses() {
  return useQuery({
    queryKey: ['lender', 'businesses'],
    queryFn: async () => {
      const res = await apiClient.get('/lender/businesses');
      return res.data as {
        total: number;
        limit: number;
        offset: number;
        items: Array<{
          business_ref: string;
          credit_band: string;
          account_age_days: number;
          has_active_loan: boolean;
          consented_at: string;
        }>;
      };
    },
  });
}

export function useLenderLoanDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      loanId,
      action,
      amount_approved,
      interest_rate,
      term_days,
      partner_ref,
      rejection_reason,
    }: {
      loanId: string;
      action: 'approve' | 'reject';
      amount_approved?: number;
      interest_rate?: number;
      term_days?: number;
      partner_ref?: string;
      rejection_reason?: string;
    }) => {
      const path = action === 'approve'
        ? `/lender/loans/${loanId}/approve`
        : `/lender/loans/${loanId}/reject`;
      const body = action === 'approve'
        ? { amount_approved, interest_rate, term_days, partner_ref }
        : { rejection_reason };
      const res = await apiClient.post(path, body);
      return res.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender', 'loans'] }),
  });
}

export function useLenderProfile() {
  return useQuery({
    queryKey: ['lender', 'profile'],
    queryFn: async () => {
      const res = await apiClient.get('/lender/me');
      return res.data as {
        lender_id: string;
        name: string;
        contact_email: string | null;
        webhook_url: string | null;
        api_key_hint: string | null;
        paystack_subaccount_code?: string | null;
        paystack_split_code?: string | null;
        settlement_bank_code?: string | null;
        settlement_account_hint?: string | null;
        platform_fee_percent?: number | null;
        settlement_ready?: boolean;
      };
    },
  });
}

export function useUpdateLenderSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { webhook_url?: string; contact_email?: string; current_password?: string; new_password?: string }) => {
      const res = await apiClient.patch('/lender/settings', body);
      return res.data as { ok: boolean; webhook_url: string | null };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender', 'profile'] }),
  });
}

export type LenderRevenueRow = {
  id: string;
  loan_request_id: string;
  business_ref: string;
  principal_amount: number;
  fee_rate_percent: number;
  fee_amount: number;
  status: string;
  provider_ref: string | null;
  earned_at: string;
  paid_at: string | null;
};

export function useLenderRevenue(status?: string) {
  return useQuery({
    queryKey: ['lender', 'revenue', status ?? 'all'],
    queryFn: async () => {
      const res = await apiClient.get('/lender/revenue', {
        params: { status: status || undefined, limit: 100 },
      });
      return res.data as { total: number; items: LenderRevenueRow[] };
    },
    refetchInterval: 120_000,
  });
}

export function useLenderRevenueSummary() {
  return useQuery({
    queryKey: ['lender', 'revenue', 'summary'],
    queryFn: async () => {
      const res = await apiClient.get('/lender/revenue/summary');
      return res.data as {
        totals: {
          earned_amount: number;
          paid_amount: number;
          reversed_amount: number;
          principal_amount: number;
          count: number;
        };
        by_status: Record<string, {
          count: number;
          fee_amount: number;
          principal_amount: number;
        }>;
      };
    },
    refetchInterval: 120_000,
  });
}

// ── Loan Products ─────────────────────────────────────────────────────────────

type LoanProduct = {
  id: string;
  name: string;
  description: string;
  min_amount_ghs: number;
  max_amount_ghs: number;
  interest_rate_annual: number;
  min_term_days: number;
  max_term_days: number;
  min_credit_band: string;
  is_active: boolean;
};

type LoanProductCreate = Omit<LoanProduct, 'id' | 'is_active'>;

export function useLenderProducts() {
  return useQuery({
    queryKey: ['lender', 'products'],
    queryFn: async () => {
      const res = await apiClient.get('/lender/products');
      return res.data as LoanProduct[];
    },
  });
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: LoanProductCreate) =>
      apiClient.post('/lender/products', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender', 'products'] }),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<LoanProductCreate> & { is_active?: boolean } }) =>
      apiClient.patch(`/lender/products/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender', 'products'] }),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/lender/products/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender', 'products'] }),
  });
}

export function useLenderCreditProfile(businessRef?: string | null) {
  return useQuery({
    enabled: !!businessRef,
    queryKey: ['lender', 'credit-profile', businessRef],
    queryFn: async () => {
      const res = await apiClient.get(`/lender/credit-profiles/${businessRef}`);
      const raw = res.data as {
        lender_business_ref?: string;
        business_ref?: string;
        credit_score?: number;
        score?: number;
        score_band?: string;
        band?: string;
        max_loan_amount?: number | string | null;
        account_age_days?: number;
        revenue_band?: string;
        repayment_history_summary?: string;
        computed_at?: string;
        monthly_revenue?: Array<{ month: string; amount: number }>;
        risk_indicators?: Array<{ label: string; value: string; tone: string }>;
        kyc_status?: string;
        consent_granted_at?: string | null;
      };
      return {
        business_ref: raw.business_ref ?? raw.lender_business_ref ?? businessRef!,
        credit_score: raw.credit_score ?? raw.score ?? 0,
        score_band: raw.score_band ?? raw.band ?? '—',
        max_loan_amount: raw.max_loan_amount ?? null,
        account_age_days: raw.account_age_days ?? null,
        revenue_band: raw.revenue_band ?? '—',
        repayment_history_summary: raw.repayment_history_summary ?? 'no_data',
        computed_at: raw.computed_at ?? null,
        monthly_revenue: raw.monthly_revenue ?? [],
        risk_indicators: raw.risk_indicators ?? [],
        kyc_status: raw.kyc_status ?? 'pending',
        consent_granted_at: raw.consent_granted_at ?? null,
      } as {
        business_ref: string;
        credit_score: number | null;
        score_band: string;
        max_loan_amount: number | string | null;
        account_age_days: number | null;
        revenue_band: string;
        repayment_history_summary: string;
        computed_at: string | null;
        monthly_revenue: Array<{ month: string; amount: number }>;
        risk_indicators: Array<{ label: string; value: string; tone: string }>;
        kyc_status: string;
        consent_granted_at: string | null;
      };
    },
  });
}

// ── New hooks ─────────────────────────────────────────────────────────────────

export function useRefreshLenderToken() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/lender/auth/refresh');
      return res.data as { access_token: string; lender_id: string; token_type: string };
    },
  });
}

export function useTestWebhook() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post('/lender/settings/test-webhook');
      return res.data as { status: string; http_status: number | null; latency_ms: number };
    },
  });
}

export function useRotateLenderKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { current_password: string }) => {
      const res = await apiClient.post('/lender/auth/rotate-key', body);
      return res.data as { api_key: string; lender_id: string; hint: string };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lender', 'profile'] }),
  });
}

export function useChangeLenderPassword() {
  return useMutation({
    mutationFn: async (body: { current_password: string; new_password: string }) => {
      const res = await apiClient.patch('/lender/settings', body);
      return res.data as { ok: boolean };
    },
  });
}

export async function exportRevenue() {
  const res = await apiClient.get('/lender/revenue/export', { responseType: 'blob' });
  const url = window.URL.createObjectURL(new Blob([res.data]));
  const a = document.createElement('a');
  a.href = url;
  a.download = `revenue-export-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export function useLenderLoan(loanId: string) {
  return useQuery({
    queryKey: ['lender', 'loan', loanId],
    queryFn: async () => {
      const res = await apiClient.get(`/lender/loans/${loanId}`);
      return res.data as {
        id: string;
        business_ref: string;
        amount_requested: number;
        amount_approved?: number | null;
        term_days?: number | null;
        credit_score: number | null;
        credit_band: string | null;
        status: string;
        requested_at: string;
      };
    },
    enabled: !!loanId,
  });
}
