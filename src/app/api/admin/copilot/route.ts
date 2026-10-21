import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { adminCopilotQuestionSchema, answerAdminCopilot, readAdminCopilotSnapshot } from '@/lib/server/admin-copilot';
import { documentIdSchema } from '@/lib/server/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    const parameters = new URL(request.url).searchParams;
    if ([...parameters.keys()].some(key => key !== 'businessId') || parameters.getAll('businessId').length > 1) throw new HttpError(400, 'Selecciona un solo negocio.');
    const value = parameters.get('businessId');
    const businessId = value === null ? undefined : documentIdSchema.parse(value);
    return NextResponse.json(await readAdminCopilotSnapshot(businessId), { headers });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    const input = await readJson(request, adminCopilotQuestionSchema, 12 * 1024);
    return NextResponse.json(await answerAdminCopilot(user.uid, input, request.signal), { headers });
  } catch (error) { return apiError(error); }
}
