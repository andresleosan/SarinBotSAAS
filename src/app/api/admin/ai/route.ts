import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { aiProviderUpdateSchema, getAdminAiSettings, saveAiProvider } from '@/lib/server/provider-settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    return NextResponse.json(await getAdminAiSettings(), { headers });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    await requireSuperadmin(request);
    const input = await readJson(request, aiProviderUpdateSchema, 1024);
    return NextResponse.json(await saveAiProvider(input.provider), { headers });
  } catch (error) { return apiError(error); }
}
