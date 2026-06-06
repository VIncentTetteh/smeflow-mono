import { toApiErrorMessage, normalizeApiError } from '@/api/errors';

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
