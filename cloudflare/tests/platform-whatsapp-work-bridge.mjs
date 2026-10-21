// Test-only runtime bridge: app TypeScript does not include Worker ambient bindings.
// The actual Worker implementation is separately checked with cloudflare/tsconfig.json.
const stagesPath = '../src/platform-whatsapp-work-stages.ts';
const retentionPath = '../src/platform-whatsapp-retention.ts';
export const { preparePlatformAudio, startPlatformAudio, finishPlatformAudio } = await import(stagesPath);
export const { cleanupPlatformWhatsAppRetention } = await import(retentionPath);
