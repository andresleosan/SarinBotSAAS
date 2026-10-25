import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { ownerWaitlistCursorSchema } from '@/lib/owner-waitlist';
import { readOwnerWaitlistDetail } from '@/lib/server/owner-waitlist';
import { apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const owner = await requireUser(request), params = await context.params;
    if (new URL(request.url).search || request.body !== null) throw new HttpError(400, 'Consulta inválida.');
    const id = ownerWaitlistCursorSchema.shape.recordId.parse(params.id), recordId = ownerWaitlistCursorSchema.shape.recordId.parse(params.recordId);
    return NextResponse.json(await readOwnerWaitlistDetail(owner, id, recordId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
