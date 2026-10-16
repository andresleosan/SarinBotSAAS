import { expect, it } from 'vitest';
import { apiError, HttpError } from '@/lib/server/http';
it('preserves the exact admission retry delay in the HTTP response', () => {
  const response = apiError(new HttpError(429, 'Espera 37 segundos.', 'CLIENT_RATE_LIMITED', 37));
  expect(response.headers.get('Retry-After')).toBe('37');
});
