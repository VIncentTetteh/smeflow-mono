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

export interface ChatProcessRequestDto {
  message: string;
  language?: string;
  session_id?: string;
}

export interface ChatResponseDto {
  message?: string;
  reply?: string;
  intent?: string;
  actions?: string[];
  entities?: object;
}
