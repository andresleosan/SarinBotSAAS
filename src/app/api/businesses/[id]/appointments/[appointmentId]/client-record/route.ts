import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/server/auth';
import { ownerClientRecordInputSchema, OwnerClientRecordModelError } from '@/lib/owner-client-record';
import { readOwnerClientRecord } from '@/lib/server/owner-client-record';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; appointmentId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const owner = await requireUser(request);
    if (request.url.includes('?')) throw new HttpError(400, 'Consulta inválida.');
    const params = await context.params, businessId = documentIdSchema.parse(params.id), appointmentId = documentIdSchema.parse(params.appointmentId);
    const input = await readJson(request, ownerClientRecordInputSchema, 2048);
    return NextResponse.json(await readOwnerClientRecord(owner, businessId, appointmentId, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof OwnerClientRecordModelError) return apiError(new HttpError(503, 'No se pueden verificar las reservas de esta cuenta.', 'CLIENT_RECORD_UNVERIFIABLE'));
    // Unknown storage errors cannot select a public status or expose upstream text.
    return apiError(error instanceof HttpError || error instanceof z.ZodError ? error : new Error());
  }
}

export async function GET(_request: Request, _context: Context) {
  return NextResponse.json({ error: 'Método no permitido.' }, { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'POST' } });
}
