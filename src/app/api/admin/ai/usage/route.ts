import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { aiUsageMonth, aiUsageMonthSchema, aiUsageProviderSchema, readAdminAiUsage } from '@/lib/server/ai-usage';
import { apiError, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    const parameters = new URL(request.url).searchParams;
    if (parameters.getAll('month').length > 1) throw new HttpError(400, 'Selecciona un solo mes.');
    if (parameters.getAll('provider').length > 1) throw new HttpError(400, 'Selecciona un solo proveedor.');
    const month = aiUsageMonthSchema.parse(parameters.get('month') ?? aiUsageMonth());
    const provider = aiUsageProviderSchema.parse(parameters.get('provider') ?? 'deepseek');
    return NextResponse.json(await readAdminAiUsage(month, undefined, provider), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
