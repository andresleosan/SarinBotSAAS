import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { readClientFactualFaqTopics } from '@/lib/server/business-factual-faq';
import { apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request), id = documentIdSchema.parse((await context.params).id);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await readClientFactualFaqTopics(user, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
