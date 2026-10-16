import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCanonicalBookingUrl } from '@/lib/server/booking-url';
afterEach(() => vi.unstubAllEnvs());
describe('canonical printed booking URL', () => {
  it('rejects_missing_or_non_origin_config', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('SARIN_PUBLIC_BOOKING_ORIGIN', '');
    for (const origin of [undefined, 'http://sarinbotsaas.pages.dev', 'https://user:password@sarinbotsaas.pages.dev', 'https://sarinbotsaas.pages.dev:443', 'https://sarinbotsaas.pages.dev/b/other', 'https://sarinbotsaas.pages.dev?x=1', 'https://sarinbotsaas.pages.dev#x', 'https://127.0.0.1', 'https://localhost', 'https://demo.example.com', 'https://preview.sarinbotsaas.pages.dev', 'https://temporary.workers.dev']) expect(() => getCanonicalBookingUrl('barberia-norte', origin)).toThrow(expect.objectContaining({ status: 503, code: 'BOOKING_ORIGIN_UNAVAILABLE' }));
  });
  it('allows_only_demo_loopback and keeps the permanent slug path', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'demo-sarin-bot');
    expect(getCanonicalBookingUrl('barberia-norte', 'http://127.0.0.1:3040')).toBe('http://127.0.0.1:3040/b/barberia-norte');
    vi.stubEnv('FIREBASE_ADMIN_PROJECT_ID', 'sarinbotsaas');
    expect(() => getCanonicalBookingUrl('barberia-norte', 'http://127.0.0.1:3040')).toThrow();
    expect(() => getCanonicalBookingUrl('../other', 'https://sarinbotsaas.pages.dev')).toThrow();
  });
  it('does not depend on branding, browser origin or Host headers', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('SARIN_PUBLIC_BOOKING_ORIGIN', 'https://sarinbotsaas.pages.dev');
    expect(getCanonicalBookingUrl('barberia-norte')).toBe('https://sarinbotsaas.pages.dev/b/barberia-norte');
  });
});
