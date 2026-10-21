import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformWhatsAppConfig, publicPlatformWhatsAppConfig, requirePlatformWhatsAppReception } from '@/lib/server/platform-whatsapp-config';
import { HttpError } from '@/lib/server/http';
import * as configuration from '@/lib/server/platform-whatsapp-config';

const names = ['PLATFORM_WHATSAPP_RECEIVE_ENABLED', 'PLATFORM_WHATSAPP_RETENTION_ENABLED', 'PLATFORM_WHATSAPP_AI_ENABLED', 'PLATFORM_WHATSAPP_SEND_ENABLED', 'PLATFORM_YCLOUD_WEBHOOK_SECRET', 'PLATFORM_WHATSAPP_CONTENT_KEY', 'PLATFORM_WHATSAPP_WABA_ID', 'PLATFORM_WHATSAPP_PHONE_E164', 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID'];
const valid = { PLATFORM_WHATSAPP_RETENTION_ENABLED: 'true', PLATFORM_YCLOUD_WEBHOOK_SECRET: ' synthetic secret ', PLATFORM_WHATSAPP_CONTENT_KEY: Buffer.alloc(32, 7).toString('base64'), PLATFORM_WHATSAPP_WABA_ID: '12345', PLATFORM_WHATSAPP_PHONE_E164: '+15550000001', PLATFORM_WHATSAPP_PHONE_NUMBER_ID: '67890' };
function configure() { for (const [name, value] of Object.entries(valid)) vi.stubEnv(name, value); }
beforeEach(() => { for (const name of names) vi.stubEnv(name, undefined); });
afterEach(() => vi.unstubAllEnvs());

describe('platform configuration', () => {
  it('parses a dedicated canonical 32-byte link key without exposing it or requiring it for reception', () => {
    configure(); vi.stubEnv(names[0], 'true');
    vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', Buffer.alloc(32, 11).toString('base64'));
    const parse = Reflect.get(configuration, 'getPlatformWhatsAppLinkKey');
    expect(typeof parse).toBe('function');
    expect(parse()).toEqual(Buffer.alloc(32, 11));
    for (const key of [undefined, '', 'A'.repeat(42) + 'B=', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), Buffer.alloc(32).toString('base64').slice(0, -1)]) {
      vi.stubEnv('PLATFORM_WHATSAPP_LINK_HMAC_KEY', key);
      expect(parse()).toBeNull();
      expect(requirePlatformWhatsAppReception(getPlatformWhatsAppConfig())).toBeUndefined();
      expect(JSON.stringify(publicPlatformWhatsAppConfig(getPlatformWhatsAppConfig())).includes('LINK_HMAC_KEY')).toBe(false);
    }
  });
  it('reports exact missing names in evaluation order without revealing values', () => {
    const config = getPlatformWhatsAppConfig();
    expect(config).toEqual({ receiveEnabled: false, retentionEnabled: false, aiEnabled: false, sendEnabled: false, configured: false, missingConfiguration: [names[1], ...names.slice(4)], scope: null, signingSecret: '', contentKey: Buffer.alloc(0) });
  });
  it('allows configured preparation with reception absent or disabled', () => {
    configure();
    expect(getPlatformWhatsAppConfig()).toMatchObject({ configured: true, receiveEnabled: false, signingSecret: ' synthetic secret ', scope: { wabaId: '12345', phoneE164: '+15550000001', phoneNumberId: '67890' } });
    vi.stubEnv(names[0], 'false');
    expect(getPlatformWhatsAppConfig().configured).toBe(true);
    expect(() => requirePlatformWhatsAppReception(getPlatformWhatsAppConfig())).toThrow(HttpError);
    vi.stubEnv(names[0], 'true');
    expect(requirePlatformWhatsAppReception(getPlatformWhatsAppConfig())).toBeUndefined();
  });
  it.each(['TRUE', '', ' true ', '1'])('rejects nonliteral flag %j exactly once', (flag) => {
    configure();
    for (const name of names.slice(0, 4)) vi.stubEnv(name, flag);
    const config = getPlatformWhatsAppConfig();
    expect(config.missingConfiguration).toEqual(names.slice(0, 4));
    expect(config).toMatchObject({ configured: false, receiveEnabled: false, retentionEnabled: false, aiEnabled: false, sendEnabled: false });
  });
  it('retention remains required while processing flags only express configuration', () => {
    configure();
    vi.stubEnv(names[1], 'false'); vi.stubEnv(names[2], 'true'); vi.stubEnv(names[3], 'true');
    expect(getPlatformWhatsAppConfig()).toMatchObject({ configured: false, aiEnabled: true, sendEnabled: true, missingConfiguration: [names[1]] });
  });
  it.each(['', ' ', '\n\t', 's'.repeat(4097)])('clears invalid signing secret', (secret) => {
    configure(); vi.stubEnv(names[4], secret);
    expect(getPlatformWhatsAppConfig()).toMatchObject({ signingSecret: '', missingConfiguration: [names[4]] });
  });
  it('accepts the inclusive secret length without trimming', () => {
    configure(); vi.stubEnv(names[4], ' '.repeat(4095) + 's');
    expect(getPlatformWhatsAppConfig().signingSecret).toHaveLength(4096);
    expect(getPlatformWhatsAppConfig().configured).toBe(true);
  });
  it.each(['', Buffer.alloc(31).toString('base64'), Buffer.alloc(33).toString('base64'), valid.PLATFORM_WHATSAPP_CONTENT_KEY + '\n', valid.PLATFORM_WHATSAPP_CONTENT_KEY.slice(0, -1), 'A'.repeat(42) + 'B='])('clears invalid/noncanonical keys', (key) => {
    configure(); vi.stubEnv(names[5], key);
    expect(getPlatformWhatsAppConfig()).toMatchObject({ contentKey: Buffer.alloc(0), missingConfiguration: [names[5]] });
  });
  it('invalidates the whole scope and lists individual bad fields in order', () => {
    configure(); vi.stubEnv(names[6], '12345\n'); vi.stubEnv(names[7], ' +15550000001'); vi.stubEnv(names[8], '1234');
    expect(getPlatformWhatsAppConfig()).toMatchObject({ scope: null, missingConfiguration: names.slice(6) });
  });
  it('projects copied fields and excludes secrets without revalidation', () => {
    configure();
    const config = getPlatformWhatsAppConfig();
    const publicConfig = publicPlatformWhatsAppConfig(config);
    expect(Object.keys(publicConfig).sort()).toEqual(['aiEnabled', 'configured', 'missingConfiguration', 'receiveEnabled', 'retentionEnabled', 'scope', 'sendEnabled']);
    publicConfig.missingConfiguration.push('test');
    publicConfig.scope!.wabaId = '99999';
    expect(config.missingConfiguration).toEqual([]);
    expect(config.scope!.wabaId).toBe('12345');
    expect(publicPlatformWhatsAppConfig({ ...config, scope: null }).scope).toBeNull();
  });
  it('requires the exact reception combination using the shared 503 error', () => {
    configure(); vi.stubEnv(names[0], 'true');
    const config = getPlatformWhatsAppConfig();
    const changes = [{ configured: false }, { receiveEnabled: false }, { retentionEnabled: false }, { scope: null }, { scope: { ...config.scope, extra: true } }, { scope: { wabaId: '12345', phoneE164: '+15550000001' } }, { contentKey: new Uint8Array(32) }, { contentKey: Buffer.alloc(31) }, { signingSecret: ' ' }, { signingSecret: 's'.repeat(4097) }];
    for (const change of changes) {
      try { requirePlatformWhatsAppReception({ ...config, ...change } as never); throw new Error('accepted'); }
      catch (error) {
        expect(error).toBeInstanceOf(HttpError);
        expect(error).toMatchObject({ status: 503, message: 'La recepción de WhatsApp de plataforma no está habilitada y configurada.' });
      }
    }
    // The guard consumes its argument, never reads current environment.
    vi.stubEnv(names[1], 'false');
    expect(requirePlatformWhatsAppReception(config)).toBeUndefined();
  });
});
