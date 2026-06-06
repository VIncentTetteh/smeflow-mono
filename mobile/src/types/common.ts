export type UUID = string;
export type ISODateTime = string;
export type DecimalString = string | number;

export type UserRole = 'owner' | 'manager' | 'staff' | 'agent' | 'platform_admin' | 'none';

export interface PaginatedResponse<T> {
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  items?: T[];
}

export interface ApiErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
  detail?: string;
}
