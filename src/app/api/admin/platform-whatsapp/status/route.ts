import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { getPlatformWhatsAppStatus, applyPlatformWhatsAppConnectionControl, platformWhatsAppConnectionControlSchema } from '@/lib/server/platform-whatsapp-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    return NextResponse.json(await getPlatformWhatsAppStatus(), { headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const actor = await requireSuperadmin(request);
    const input = await readJson(request, platformWhatsAppConnectionControlSchema, 2048);
    return NextResponse.json(await applyPlatformWhatsAppConnectionControl(input, actor.uid), { headers });
  } catch (error) { return apiError(error); }
}
