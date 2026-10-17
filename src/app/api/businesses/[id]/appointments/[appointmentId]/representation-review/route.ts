import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { representationReviewInputSchema, updateRepresentationReview } from '@/lib/server/representation-review';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string; appointmentId: string }> }) {
  try {
    const owner = await requireUser(request); if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const params = await context.params, businessId = documentIdSchema.parse(params.id), appointmentId = documentIdSchema.parse(params.appointmentId);
    return NextResponse.json({ appointment: await updateRepresentationReview(owner, businessId, appointmentId, await readJson(request, representationReviewInputSchema, 1024)) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
