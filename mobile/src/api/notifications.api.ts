import { apiClient } from './client';
import type {
  BulkMessageRequestDto,
  BulkMessageResponseDto,
  NotificationEventResponseDto,
  NotificationPreferenceResponseDto,
  NotificationPreferenceUpdateDto,
  CustomerMessageDto,
  CustomerMessageListDto,
  MerchantAlertDto,
  MerchantAlertListDto,
} from '@/types/notifications';

export async function getNotificationPreferences(): Promise<NotificationPreferenceResponseDto> {
  const response = await apiClient.get<NotificationPreferenceResponseDto>(
    '/api/v1/notifications/preferences'
  );
  return response.data;
}

export async function updateNotificationPreferences(
  body: NotificationPreferenceUpdateDto
): Promise<NotificationPreferenceResponseDto> {
  const response = await apiClient.put<NotificationPreferenceResponseDto>(
    '/api/v1/notifications/preferences',
    body
  );
  return response.data;
}

export async function listNotificationEvents(): Promise<NotificationEventResponseDto[]> {
  const response = await apiClient.get<NotificationEventResponseDto[]>(
    '/api/v1/notifications/events'
  );
  return response.data;
}

export async function retryNotificationEvent(
  eventId: string
): Promise<NotificationEventResponseDto> {
  const response = await apiClient.post<NotificationEventResponseDto>(
    `/api/v1/notifications/events/${eventId}/retry`,
    {}
  );
  return response.data;
}

export async function sendBulkMessage(
  body: BulkMessageRequestDto
): Promise<BulkMessageResponseDto> {
  const response = await apiClient.post<BulkMessageResponseDto>('/api/v1/notifications/bulk', body);
  return response.data;
}

export async function listMerchantAlerts(
  view: 'attention' | 'history'
): Promise<MerchantAlertListDto> {
  const response = await apiClient.get<MerchantAlertListDto>('/api/v1/notifications/alerts', {
    params: { view },
  });
  return response.data;
}

export async function markMerchantAlertRead(alertId: string): Promise<MerchantAlertDto> {
  const response = await apiClient.post<MerchantAlertDto>(
    `/api/v1/notifications/alerts/${alertId}/read`,
    {}
  );
  return response.data;
}

export async function dismissMerchantAlert(
  alertId: string,
  reason: string
): Promise<MerchantAlertDto> {
  const response = await apiClient.post<MerchantAlertDto>(
    `/api/v1/notifications/alerts/${alertId}/dismiss`,
    { reason }
  );
  return response.data;
}

export async function listCustomerDeliveries(): Promise<CustomerMessageListDto> {
  const response = await apiClient.get<CustomerMessageListDto>('/api/v1/notifications/deliveries');
  return response.data;
}

export async function retryCustomerDelivery(messageId: string): Promise<CustomerMessageDto> {
  const response = await apiClient.post<CustomerMessageDto>(
    `/api/v1/notifications/deliveries/${messageId}/retry`,
    {}
  );
  return response.data;
}
