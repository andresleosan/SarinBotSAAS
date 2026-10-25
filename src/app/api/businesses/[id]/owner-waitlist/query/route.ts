import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { ownerWaitlistCursorSchema, ownerWaitlistQuerySchema } from '@/lib/owner-waitlist';
import { readOwnerWaitlistPage } from '@/lib/server/owner-waitlist';
import { readJson, apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const owner = await requireUser(request), id = ownerWaitlistCursorSchema.shape.recordId.parse((await context.params).id);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await readOwnerWaitlistPage(owner, id, await readJson(request, ownerWaitlistQuerySchema, 2048)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
