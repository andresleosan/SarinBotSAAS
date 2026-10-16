import { NextResponse } from 'next/server';
import { apiError } from '@/lib/server/http';
import { readSignedWebhook, verifyWhatsAppChallenge } from '@/lib/server/whatsapp-security';
import { ingestWhatsAppWebhook } from '@/lib/server/whatsapp-store';
import { kickWhatsAppWorker } from '@/lib/server/whatsapp-worker';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try { return new Response(verifyWhatsAppChallenge(new URL(request.url)), { status: 200, headers }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    await ingestWhatsAppWebhook(await readSignedWebhook(request));
    kickWhatsAppWorker();
    return NextResponse.json({ received: true }, { headers });
  } catch (error) { return apiError(error); }
}
