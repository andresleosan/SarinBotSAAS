import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/server/auth';
import { confirmOwnerReschedule } from '@/lib/server/owner-rescheduling';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const confirmation = z.object({ confirm: z.literal(true) }).strict();
type Context = { params: Promise<{ id: string; proposalId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const owner = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const params = await context.params, businessId = documentIdSchema.parse(params.id), proposalId = documentIdSchema.parse(params.proposalId);
    await readJson(request, confirmation, 1024);
    return NextResponse.json(await confirmOwnerReschedule(owner, businessId, proposalId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
