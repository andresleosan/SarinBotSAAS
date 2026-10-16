import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { aiUsageMonth, aiUsageMonthSchema, readAdminAiUsage } from '@/lib/server/ai-usage';
import { apiError, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    const parameters = new URL(request.url).searchParams;
    if (parameters.getAll('month').length > 1) throw new HttpError(400, 'Selecciona un solo mes.');
    const month = aiUsageMonthSchema.parse(parameters.get('month') ?? aiUsageMonth());
    return NextResponse.json(await readAdminAiUsage(month), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
