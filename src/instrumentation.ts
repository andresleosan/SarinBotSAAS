export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && (process.env.WHATSAPP_ENABLED === 'true' || process.env.WHATSAPP_RETENTION_ENABLED === 'true')) {
    const { startWhatsAppWorker } = await import('@/lib/server/whatsapp-worker');
    startWhatsAppWorker();
  }
}
