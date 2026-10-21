// Manual optional bindings for the restored platform bridge; no runtime defaults.
interface PlatformWhatsAppBindings {
  PLATFORM_WHATSAPP_RECEIVE_ENABLED?: string;
  PLATFORM_WHATSAPP_RETENTION_ENABLED?: string;
  PLATFORM_WHATSAPP_AI_ENABLED?: string;
  PLATFORM_WHATSAPP_SEND_ENABLED?: string;
  PLATFORM_YCLOUD_WEBHOOK_SECRET?: string;
  PLATFORM_WHATSAPP_CONTENT_KEY?: string;
  PLATFORM_WHATSAPP_WABA_ID?: string;
  PLATFORM_WHATSAPP_PHONE_E164?: string;
  PLATFORM_WHATSAPP_PHONE_NUMBER_ID?: string;
  PLATFORM_YCLOUD_DIAGNOSTIC_ENABLED?: string;
  PLATFORM_YCLOUD_DIAGNOSTIC_RUN_ID?: string;
  PLATFORM_YCLOUD_DIAGNOSTIC_EXPIRES_AT?: string;
  PLATFORM_YCLOUD_DIAGNOSTIC_SENDER?: string;
  PLATFORM_YCLOUD_DIAGNOSTIC_NONCE?: string;
}
interface CloudflareBindings extends PlatformWhatsAppBindings {}
declare namespace Cloudflare {
  interface Env extends PlatformWhatsAppBindings {}
}
