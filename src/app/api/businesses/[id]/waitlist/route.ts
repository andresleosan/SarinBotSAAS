import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { joinWaitlist, readWaitlist, waitlistJoinInputSchema } from '@/lib/server/waitlist';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await readWaitlist(user, documentIdSchema.parse((await context.params).id)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const id = documentIdSchema.parse((await context.params).id), input = await readJson(request, waitlistJoinInputSchema, 8192);
    return NextResponse.json(await joinWaitlist(user, id, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
