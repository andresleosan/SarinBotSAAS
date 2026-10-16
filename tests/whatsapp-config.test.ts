import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { syntheticWhatsAppEnv } from './whatsapp-fixtures';
const state = vi.hoisted(() => ({ db: undefined as unknown, verify: vi.fn() }));
vi.mock('@/lib/firebase/admin', () => ({ getAdminDb: () => state.db, getAdminAuth: () => ({ verifyIdToken: state.verify }) }));
import { getWhatsAppBusinessStatus, getWhatsAppSettings, saveWhatsAppBinding } from '@/lib/server/whatsapp-config';

beforeEach(() => {
  syntheticWhatsAppEnv();
  state.db = memoryFirestore({ 'businesses/business_a': { id: 'business_a' }, 'businesses/business_b': { id: 'business_b' } }).db;
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '100001', status: 'CONNECTED' })));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('private WhatsApp configuration', () => {
  it('does not advertise a connection with only environment credentials', async () => {
    expect(await getWhatsAppBusinessStatus('business_a')).toEqual({ ready: false });
    expect(await getWhatsAppSettings()).toMatchObject({ configured: true, enabled: true, bindings: [] });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('allows paused preparation without credentials or network', async () => {
    vi.stubEnv('WHATSAPP_CONTENT_KEY', '');
    await saveWhatsAppBinding({ businessId: 'business_a', phoneNumberId: '100001', wabaId: '200001', enabled: false });
    const result = await getWhatsAppSettings();
    expect(result).toMatchObject({ configured: false, missingConfiguration: ['WHATSAPP_CONTENT_KEY'], bindings: [{ status: 'paused', credentialConfigured: true }] });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('verifies a registered number through the fixed Meta endpoint before enabling', async () => {
    await saveWhatsAppBinding({ businessId: 'business_a', phoneNumberId: '100001', wabaId: '200001', enabled: true });
    expect(await getWhatsAppBusinessStatus('business_a')).toEqual({ ready: true });
    const [url, options] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v25.0/100001?fields=id,status');
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(JSON.stringify(await getWhatsAppSettings())).not.toMatch(/synthetic|accessToken|appSecret|contentKey/);
  });
  it.each(['missing-key', 'missing-token', 'wrong-waba', 'disconnected', 'wrong-id', 'error', 'retention-disabled'])('fails closed before enabling: %s', async failure => {
    if (failure === 'missing-key') vi.stubEnv('WHATSAPP_CONTENT_KEY', 'invalid');
    if (failure === 'missing-token') vi.stubEnv('WHATSAPP_PHONE_CREDENTIALS_JSON', '{}');
    if (failure === 'wrong-waba') vi.stubEnv('WHATSAPP_PHONE_CREDENTIALS_JSON', JSON.stringify({ '100001': { wabaId: '200002', accessToken: 'synthetic-token' } }));
    if (failure === 'disconnected') vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '100001', status: 'PENDING' })));
    if (failure === 'wrong-id') vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: '999999', status: 'CONNECTED' })));
    if (failure === 'error') vi.stubGlobal('fetch', vi.fn(async () => new Response('secret upstream', { status: 401 })));
    if (failure === 'retention-disabled') vi.stubEnv('WHATSAPP_RETENTION_ENABLED', 'false');
    await expect(saveWhatsAppBinding({ businessId: 'business_a', phoneNumberId: '100001', wabaId: '200001', enabled: true })).rejects.toMatchObject({ status: 503 });
    expect(await getWhatsAppBusinessStatus('business_a')).toEqual({ ready: false });
  });
  it('prevents reassigning a number or assigning a second number to the same business', async () => {
    await saveWhatsAppBinding({ businessId: 'business_a', phoneNumberId: '100001', wabaId: '200001', enabled: false });
    await expect(saveWhatsAppBinding({ businessId: 'business_b', phoneNumberId: '100001', wabaId: '200001', enabled: false })).rejects.toMatchObject({ status: 409 });
    await expect(saveWhatsAppBinding({ businessId: 'business_a', phoneNumberId: '100002', wabaId: '200001', enabled: false })).rejects.toMatchObject({ status: 409 });
  });
  it('disabling the global gate prevents a previously verified binding from being ready', async () => {
    await saveWhatsAppBinding({ businessId: 'business_a', phoneNumberId: '100001', wabaId: '200001', enabled: true });
    vi.stubEnv('WHATSAPP_ENABLED', 'false');
    expect(await getWhatsAppBusinessStatus('business_a')).toEqual({ ready: false });
  });
});
