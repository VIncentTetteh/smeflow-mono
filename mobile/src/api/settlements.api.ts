import { apiClient } from './client';
import type {
  MerchantLedgerResponseDto,
  MerchantSettlementBalanceDto,
  MerchantSettlementHistoryResponseDto,
  MerchantSettlementRequestDto,
  MerchantSettlementRequestResponseDto,
  SettlementLedgerEntryType,
} from '@/types/settlements';

export async function getSettlementBalance(): Promise<MerchantSettlementBalanceDto> {
  const response = await apiClient.get<MerchantSettlementBalanceDto>('/api/v1/settlements/balance');
  return response.data;
}

export async function getSettlementLedger(params?: {
  type?: SettlementLedgerEntryType | string;
  limit?: number;
  offset?: number;
}): Promise<MerchantLedgerResponseDto> {
  const response = await apiClient.get<MerchantLedgerResponseDto>('/api/v1/settlements/ledger', {
    params,
  });
  return response.data;
}

export async function listMerchantSettlements(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<MerchantSettlementHistoryResponseDto> {
  const response = await apiClient.get<MerchantSettlementHistoryResponseDto>('/api/v1/settlements', {
    params,
  });
  return response.data;
}

export interface SettlementPreviewDto {
  gross_amount: string;
  transfer_fee: string;
  net_amount: string;
  can_settle: boolean;
  reason?: string;
  requires_admin_approval?: boolean;
  auto_approve_ceiling_ghs?: string;
  unsettled_balance: string;
}

export async function previewMerchantSettlement(amount: number): Promise<SettlementPreviewDto> {
  const response = await apiClient.get<SettlementPreviewDto>('/api/v1/settlements/preview', {
    params: { amount },
  });
  return response.data;
}

export async function requestMerchantSettlement(
  body: MerchantSettlementRequestDto
): Promise<MerchantSettlementRequestResponseDto> {
  const response = await apiClient.post<MerchantSettlementRequestResponseDto>(
    '/api/v1/settlements/request',
    body
  );
  return response.data;
}

export async function cancelMerchantSettlement(settlementId: string, reason = ''): Promise<{
  settlement_id: string;
  status: string;
  message: string;
}> {
  const response = await apiClient.delete(`/api/v1/settlements/${settlementId}`, {
    data: { reason },
  });
  return response.data;
}
