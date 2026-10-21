import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { getYCloudRetryDiagnosticConfig, getYCloudRetryDiagnosticObserver, readYCloudRetryDiagnosticSummary, closeYCloudRetryDiagnostic } from '@/lib/server/ycloud-retry-diagnostic';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    return NextResponse.json(await readYCloudRetryDiagnosticSummary(getAdminDb()), { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    await requireSuperadmin(request);
    await readJson(request, z.object({}).strict(), 64);
    const config = getYCloudRetryDiagnosticConfig();
    if (!config) throw new HttpError(503, 'El diagnóstico está deshabilitado.');
    await getYCloudRetryDiagnosticObserver(config, getAdminDb()).arm();
    return new Response(null, { status: 204, headers });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    await requireSuperadmin(request);
    await closeYCloudRetryDiagnostic(getAdminDb());
    return new Response(null, { status: 204, headers });
  } catch (error) { return apiError(error); }
}
