import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { businessLogoSchema, saveBusinessLogo } from '@/lib/server/business-logos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = await readJson(request, businessLogoSchema, 3 * 1024 * 1024);
    return NextResponse.json({ business: await saveBusinessLogo(user, input) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
