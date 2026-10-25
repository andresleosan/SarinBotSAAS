import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { ownerRescheduleCommandSchema } from '@/lib/owner-rescheduling';
import { prepareOwnerReschedule } from '@/lib/server/owner-rescheduling';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; appointmentId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const owner = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const params = await context.params, businessId = documentIdSchema.parse(params.id), appointmentId = documentIdSchema.parse(params.appointmentId);
    const input = await readJson(request, ownerRescheduleCommandSchema, 4096), result = await prepareOwnerReschedule(owner, businessId, appointmentId, input);
    return NextResponse.json({ proposal: result.proposal }, { status: result.replayed ? 200 : 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
