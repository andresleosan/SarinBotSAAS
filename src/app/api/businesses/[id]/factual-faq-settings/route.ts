import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { factualFaqCommandSchema } from '@/lib/business-factual-faq';
import { readOwnerFactualFaq, saveOwnerFactualFaq } from '@/lib/server/business-factual-faq';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request), id = documentIdSchema.parse((await context.params).id), query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'requestId') || query.getAll('requestId').length > 1) throw new HttpError(400, 'Consulta inválida.');
    const requestId = query.has('requestId') ? factualFaqCommandSchema.shape.requestId.parse(query.get('requestId')) : undefined;
    return NextResponse.json(await readOwnerFactualFaq(user, id, requestId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireUser(request), id = documentIdSchema.parse((await context.params).id);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await saveOwnerFactualFaq(user, id, await readJson(request, factualFaqCommandSchema, 8192)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
