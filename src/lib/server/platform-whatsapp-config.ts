import 'server-only';
import { z } from 'zod';
import { PLATFORM_ID_PATTERN, PLATFORM_PHONE_PATTERN, type PlatformWhatsAppScope } from '../../../shared/platform-whatsapp-records';
import { HttpError } from '@/lib/server/http';

const idSchema = z.string().regex(PLATFORM_ID_PATTERN);
const scopeSchema = z.object({ wabaId: idSchema, phoneE164: z.string().regex(PLATFORM_PHONE_PATTERN), phoneNumberId: idSchema }).strict();

export interface PlatformWhatsAppConfig {
  receiveEnabled: boolean;
  retentionEnabled: boolean;
  aiEnabled: boolean;
  sendEnabled: boolean;
  configured: boolean;
  missingConfiguration: string[];
  scope: PlatformWhatsAppScope | null;
  signingSecret: string;
  contentKey: Buffer;
}
export type PublicPlatformWhatsAppConfig = Omit<PlatformWhatsAppConfig, 'signingSecret' | 'contentKey'>;

export function getPlatformWhatsAppConfig(): PlatformWhatsAppConfig {
  const missingConfiguration: string[] = [];
  function flag(name: string): boolean {
    const value = process.env[name];
    if (value !== undefined && value !== 'true' && value !== 'false') missingConfiguration.push(name);
    return value === 'true';
  }
  const receiveEnabled = flag('PLATFORM_WHATSAPP_RECEIVE_ENABLED');
  const retentionEnabled = flag('PLATFORM_WHATSAPP_RETENTION_ENABLED');
  if (!retentionEnabled && !missingConfiguration.includes('PLATFORM_WHATSAPP_RETENTION_ENABLED')) missingConfiguration.push('PLATFORM_WHATSAPP_RETENTION_ENABLED');
  const aiEnabled = flag('PLATFORM_WHATSAPP_AI_ENABLED'), sendEnabled = flag('PLATFORM_WHATSAPP_SEND_ENABLED');
  let signingSecret = process.env.PLATFORM_YCLOUD_WEBHOOK_SECRET ?? '';
  if (!/\S/.test(signingSecret) || signingSecret.length > 4096) {
    missingConfiguration.push('PLATFORM_YCLOUD_WEBHOOK_SECRET');
    signingSecret = '';
  }
  const encodedKey = process.env.PLATFORM_WHATSAPP_CONTENT_KEY ?? '';
  let contentKey = Buffer.from(encodedKey, 'base64');
  if (contentKey.length !== 32 || contentKey.toString('base64') !== encodedKey) {
    missingConfiguration.push('PLATFORM_WHATSAPP_CONTENT_KEY');
    contentKey = Buffer.alloc(0);
  }
  const scope = scopeSchema.safeParse({ wabaId: process.env.PLATFORM_WHATSAPP_WABA_ID, phoneE164: process.env.PLATFORM_WHATSAPP_PHONE_E164, phoneNumberId: process.env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID });
  if (!scope.success) {
    const names: Record<string, string> = { wabaId: 'PLATFORM_WHATSAPP_WABA_ID', phoneE164: 'PLATFORM_WHATSAPP_PHONE_E164', phoneNumberId: 'PLATFORM_WHATSAPP_PHONE_NUMBER_ID' };
    for (const issue of scope.error.issues) {
      const name = names[String(issue.path[0])];
      if (name && !missingConfiguration.includes(name)) missingConfiguration.push(name);
    }
  }
  return { receiveEnabled, retentionEnabled, aiEnabled, sendEnabled, configured: missingConfiguration.length === 0, missingConfiguration, scope: scope.success ? scope.data : null, signingSecret, contentKey };
}

export function publicPlatformWhatsAppConfig(config: PlatformWhatsAppConfig): PublicPlatformWhatsAppConfig {
  return {
    receiveEnabled: config.receiveEnabled, retentionEnabled: config.retentionEnabled,
    aiEnabled: config.aiEnabled, sendEnabled: config.sendEnabled, configured: config.configured,
    missingConfiguration: [...config.missingConfiguration],
    scope: config.scope ? { wabaId: config.scope.wabaId, phoneE164: config.scope.phoneE164, phoneNumberId: config.scope.phoneNumberId } : null,
  };
}

export function requirePlatformWhatsAppReception(config: PlatformWhatsAppConfig): void {
  if (!config.configured || !config.receiveEnabled || !config.retentionEnabled
    || !scopeSchema.safeParse(config.scope).success || !Buffer.isBuffer(config.contentKey) || config.contentKey.length !== 32
    || typeof config.signingSecret !== 'string' || !/\S/.test(config.signingSecret) || config.signingSecret.length > 4096) {
    throw new HttpError(503, 'La recepción de WhatsApp de plataforma no está habilitada y configurada.');
  }
}

/** Dedicated optional key; never part of reception diagnostics or public config. */
export function getPlatformWhatsAppLinkKey(): Buffer | null {
  const encoded = process.env.PLATFORM_WHATSAPP_LINK_HMAC_KEY;
  if (typeof encoded !== 'string') return null;
  const key = Buffer.from(encoded, 'base64');
  return key.length === 32 && key.toString('base64') === encoded ? key : null;
}
