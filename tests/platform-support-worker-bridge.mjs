const data = '../cloudflare/src/data.ts', retention = '../cloudflare/src/platform-whatsapp-retention.ts';
export const { executeDataCommand } = await import(data);
export const { cleanupPlatformWhatsAppRetention } = await import(retention);
const supportRetention = '../cloudflare/src/platform-support-retention.ts', fixture = '../cloudflare/tests/platform-whatsapp-fixture.mjs';
export const { cleanupPlatformSupportRetention } = await import(supportRetention);
export const { observeDatabase } = await import(fixture);
