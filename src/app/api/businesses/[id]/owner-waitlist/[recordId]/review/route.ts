import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { ownerWaitlistCursorSchema, ownerWaitlistReviewCommandSchema } from '@/lib/owner-waitlist';
import { updateOwnerWaitlistReview, readOwnerWaitlistReviewState } from '@/lib/server/owner-waitlist';
import { readJson, apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const owner = await requireUser(request), params = await context.params;
    if (new URL(request.url).search || request.body !== null) throw new HttpError(400, 'Consulta inválida.');
    const id = ownerWaitlistCursorSchema.shape.recordId.parse(params.id), recordId = ownerWaitlistCursorSchema.shape.recordId.parse(params.recordId);
    return NextResponse.json(await readOwnerWaitlistReviewState(owner, id, recordId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const owner = await requireUser(request), params = await context.params;
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const id = ownerWaitlistCursorSchema.shape.recordId.parse(params.id), recordId = ownerWaitlistCursorSchema.shape.recordId.parse(params.recordId);
    return NextResponse.json(await updateOwnerWaitlistReview(owner, id, recordId, await readJson(request, ownerWaitlistReviewCommandSchema, 2048)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
