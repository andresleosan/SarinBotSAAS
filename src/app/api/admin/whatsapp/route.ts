import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { getWhatsAppSettings, saveWhatsAppBinding, whatsAppBindingSchema } from '@/lib/server/whatsapp-config';
import { getWhatsAppUsage } from '@/lib/server/whatsapp-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try { await requireSuperadmin(request); return NextResponse.json({ ...await getWhatsAppSettings(), usage: await getWhatsAppUsage() }, { headers }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { await requireSuperadmin(request); return NextResponse.json({ ...await saveWhatsAppBinding(await readJson(request, whatsAppBindingSchema, 2048)), usage: await getWhatsAppUsage() }, { headers }); }
  catch (error) { return apiError(error); }
}
