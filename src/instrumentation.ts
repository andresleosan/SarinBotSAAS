export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.PLATFORM_WHATSAPP_PROCESSING_ENABLED === 'true') {
    const { startPlatformWhatsAppWorker } = await import('@/lib/server/platform-whatsapp-worker');
    startPlatformWhatsAppWorker();
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && (process.env.WHATSAPP_ENABLED === 'true' || process.env.WHATSAPP_RETENTION_ENABLED === 'true')) {
    const { startWhatsAppWorker } = await import('@/lib/server/whatsapp-worker');
    startWhatsAppWorker();
  }
}
