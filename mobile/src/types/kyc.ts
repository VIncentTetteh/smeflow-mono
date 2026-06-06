import type { ISODateTime, UUID } from './common';

export interface BusinessKYCSubmitDto {
  ghana_card_id?: string;
  tin?: string;
  business_registration_ref?: string;
  documents?: object;
}

export interface BusinessKYCResponseDto {
  id: UUID;
  business_id: UUID;
  user_id: UUID;
  ghana_card_id: string | null;
  tin: string | null;
  business_registration_ref: string | null;
  status: 'verified' | 'failed' | 'pending' | string;
  provider: string | null;
  provider_ref: string | null;
  failure_reason: string | null;
  documents: object;
  submitted_at: ISODateTime;
  reviewed_at: ISODateTime | null;
}
