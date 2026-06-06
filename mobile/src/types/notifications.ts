import type { ISODateTime, UUID } from './common';

export interface NotificationPreferenceUpdateDto {
  whatsapp_enabled?: boolean;
  sms_enabled?: boolean;
  push_enabled?: boolean;
  event_prefs?: object;
}

export interface NotificationPreferenceResponseDto {
  id: UUID;
  whatsapp_enabled: boolean;
  sms_enabled: boolean;
  push_enabled: boolean;
  event_prefs: object;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface NotificationEventResponseDto {
  id: UUID;
  event_type: string;
  channel: string;
  phone: string | null;
  message: string;
  status: string;
  provider_response: object | null;
  retryable?: boolean;
  error_message?: string | null;
  provider_reference?: string | null;
  fallback_from?: 'whatsapp' | 'sms' | null;
  created_at: ISODateTime;
  sent_at: ISODateTime | null;
}

export interface BulkMessageRequestDto {
  message: string;
  recipient_type: 'customers' | 'staff' | 'all' | string;
  channel?: 'whatsapp' | 'sms' | string;
}

export interface BulkMessageResponseDto {
  message_id: UUID;
  recipient_count: number;
  status: string;
  estimated_cost: number | null;
}

export interface MerchantAlertDto {
  id: UUID;
  alert_type: string;
  severity: 'critical' | 'operational' | string;
  title: string;
  message: string;
  status: 'needs_attention' | 'resolved' | 'dismissed' | string;
  resource_type: string | null;
  resource_id: string | null;
  action_path: string | null;
  action_label: string | null;
  occurrence_count: number;
  read_at: ISODateTime | null;
  resolved_at: ISODateTime | null;
  dismissed_at: ISODateTime | null;
  dismissal_reason: string | null;
  latest_at: ISODateTime;
  created_at: ISODateTime;
  provider_error: null;
}

export interface MerchantAlertListDto {
  items: MerchantAlertDto[];
  unread_count: number;
}

export interface DeliveryAttemptDto {
  id: UUID;
  channel: string;
  provider: string;
  attempt_number: number;
  status: string;
  provider_reference: string | null;
  failure_category: string | null;
  failure_detail: string | null;
  fallback_from: string | null;
  requested_at: ISODateTime;
  completed_at: ISODateTime | null;
}

export interface CustomerMessageDto {
  id: UUID;
  message_type: string;
  recipient_masked: string;
  preferred_channel: string;
  consent_status: string;
  related_resource_type: string | null;
  related_resource_id: string | null;
  status: string;
  completed_at: ISODateTime | null;
  created_at: ISODateTime;
  attempts: DeliveryAttemptDto[];
}

export interface CustomerMessageListDto {
  items: CustomerMessageDto[];
}
