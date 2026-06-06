import { apiClient } from './client';
import type {
  ChatHistoryResponseDto,
  ChatProcessRequestDto,
  ChatResponseDto,
} from '@/types/chat';

export async function getChatHistory(): Promise<ChatHistoryResponseDto> {
  const response = await apiClient.get<ChatHistoryResponseDto>('/api/v1/chat/history');
  return response.data;
}

export async function processChatMessage(body: ChatProcessRequestDto): Promise<ChatResponseDto> {
  const response = await apiClient.post<ChatResponseDto>('/api/v1/chat/process', body);
  return response.data;
}

export async function clearChatHistory(): Promise<void> {
  await apiClient.delete('/api/v1/chat/history');
}
