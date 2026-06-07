import { toApiErrorMessage, normalizeApiError, is402Error } from '@/api/errors';

describe('API error handling', () => {
  it('normalizes the SMEflow backend error envelope', () => {
    const error = normalizeApiError({
      response: {
        status: 422,
        data: {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ field: 'body → phone', message: 'Invalid phone' }],
          },
        },
      },
    });

    expect(error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Request validation failed',
      status: 422,
      details: [{ field: 'body → phone', message: 'Invalid phone' }],
    });
  });

  it('falls back to a useful message for network errors', () => {
    expect(toApiErrorMessage({ request: {} })).toBe(
      'Network unavailable. Check your connection and try again.'
    );
  });
});

describe('is402Error', () => {
  it('returns true for a 402 AxiosError', () => {
    const err = { response: { status: 402 } };
    expect(is402Error(err)).toBe(true);
  });

  it('returns false for a 404 AxiosError', () => {
    const err = { response: { status: 404 } };
    expect(is402Error(err)).toBe(false);
  });

  it('returns false for a non-axios error', () => {
    expect(is402Error(new Error('network'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(is402Error(null)).toBe(false);
  });
});
