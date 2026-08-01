import type { ISODateTime, UUID } from './common';

export interface ChatMessageDto {
  id?: UUID | string;
  sender?: 'user' | 'assistant' | string;
  text?: string;
  message?: string;
  created_at?: ISODateTime;
}

export interface ChatHistoryResponseDto {
  messages: ChatMessageDto[];
}

export interface PendingAction {
  proposal_type: 'record_sale' | 'adjust_stock';
  item_id: string;
  item_name: string;
  qty?: number;
  unit_price?: number;
  total?: number;
  qty_change?: number;
  reason?: string;
  current_stock?: number;
  projected_stock?: number;
}

export interface ChatProcessRequestDto {
  message: string;
  language?: string;
  session_id?: string;
  confirm_action?: PendingAction;
}

export interface ChatResponseDto {
  message?: string;
  reply?: string;
  intent?: string;
  actions_taken?: string[];
  entities?: object;
  pending_action?: PendingAction | null;
}
