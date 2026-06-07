import { AxiosError } from 'axios';
import type { ApiErrorEnvelope } from '@/types/common';

export interface NormalizedApiError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
}

export function normalizeApiError(error: unknown): NormalizedApiError {
  const axiosError = error as AxiosError<ApiErrorEnvelope> | undefined;
  const status = axiosError?.response?.status;
  const data = axiosError?.response?.data;
  const envelope = data?.error;

  if (envelope?.message) {
    return {
      code: envelope.code ?? `HTTP_${status ?? 'ERROR'}`,
      message: envelope.message,
      status,
      details: envelope.details,
    };
  }

  if (data?.detail) {
    return {
      code: `HTTP_${status ?? 'ERROR'}`,
      message: data.detail,
      status,
    };
  }

  if (axiosError?.request && !axiosError.response) {
    return {
      code: 'NETWORK_ERROR',
      message: 'Network unavailable. Check your connection and try again.',
    };
  }

  return {
    code: `HTTP_${status ?? 'ERROR'}`,
    message: axiosError?.message || 'Something went wrong. Please try again.',
    status,
  };
}

export function toApiErrorMessage(error: unknown): string {
  return normalizeApiError(error).message;
}

export function isKycRequiredError(error: unknown): boolean {
  return normalizeApiError(error).code === 'KYC_VERIFICATION_REQUIRED';
}

export function is402Error(error: unknown): boolean {
  return normalizeApiError(error).status === 402;
}
