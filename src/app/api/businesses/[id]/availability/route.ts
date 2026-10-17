import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { structuredAvailabilitySchema, documentIdSchema } from '@/lib/server/schemas';
import { readStructuredAvailability } from '@/lib/server/structured-booking';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request); if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const id = documentIdSchema.parse((await context.params).id), input = await readJson(request, structuredAvailabilitySchema, 8192);
    return NextResponse.json({ availability: await readStructuredAvailability(user, id, input) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
