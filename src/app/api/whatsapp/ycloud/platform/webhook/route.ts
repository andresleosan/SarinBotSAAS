import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { apiError } from '@/lib/server/http';
import { getPlatformWhatsAppConfig, requirePlatformWhatsAppReception } from '@/lib/server/platform-whatsapp-config';
import { readYCloudWebhook } from '@/lib/server/ycloud-webhook';
import { ingestPlatformWhatsAppEvent } from '@/lib/server/platform-whatsapp-ingress';
import { verifyPlatformWhatsAppLinkInbound } from '@/lib/server/platform-whatsapp-link';
import { getYCloudRetryDiagnosticConfig, getYCloudRetryDiagnosticObserver } from '@/lib/server/ycloud-retry-diagnostic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function POST(request: Request) {
  try {
    const diagnostic = getYCloudRetryDiagnosticConfig();
    if (diagnostic) {
      const status = await getYCloudRetryDiagnosticObserver(diagnostic, getAdminDb()).observe(request);
      return new Response(null, { status, headers });
    }
    const config = getPlatformWhatsAppConfig();
    requirePlatformWhatsAppReception(config);
    const event = await readYCloudWebhook(request, { signingSecret: config.signingSecret, scope: { wabaId: config.scope!.wabaId, phoneE164: config.scope!.phoneE164 } });
    if (event?.kind === 'incoming_text' && await verifyPlatformWhatsAppLinkInbound(event) !== 'not_control') return NextResponse.json({ received: true }, { headers });
    if (event && (event.kind === 'incoming_text' || event.kind === 'human_echo')) await ingestPlatformWhatsAppEvent(event, config, getAdminDb());
    return NextResponse.json({ received: true }, { headers });
  } catch (error) { return apiError(error); }
}
