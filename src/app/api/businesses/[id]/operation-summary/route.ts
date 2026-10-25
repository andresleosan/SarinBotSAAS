import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { readOwnerOperationSummary } from '@/lib/server/owner-operation-summary';
import { apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request), id = documentIdSchema.parse((await context.params).id), query = new URL(request.url).searchParams;
    if (request.body !== null || [...query.keys()].some(key => !['from', 'through'].includes(key)) || query.getAll('from').length !== 1 || query.getAll('through').length !== 1) throw new HttpError(400, 'Envía un único periodo de fechas, sin datos adicionales.', 'OPERATION_SUMMARY_INVALID_RANGE');
    const result = await readOwnerOperationSummary(user, id, { from: query.get('from')!, through: query.get('through')! });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
