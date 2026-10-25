import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { readOwnerRescheduleProposal } from '@/lib/server/owner-rescheduling';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const owner = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const params = await context.params, businessId = documentIdSchema.parse(params.id), proposalId = documentIdSchema.parse(params.proposalId);
    return NextResponse.json(await readOwnerRescheduleProposal(owner, businessId, proposalId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
