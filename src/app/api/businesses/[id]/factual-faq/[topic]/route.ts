import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { factualFaqTopicSchema } from '@/lib/business-factual-faq';
import { readClientFactualFaqAnswer } from '@/lib/server/business-factual-faq';
import { apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; topic: string }> }) {
  try {
    const user = await requireUser(request), params = await context.params, id = documentIdSchema.parse(params.id), topic = factualFaqTopicSchema.parse(params.topic), query = new URL(request.url).searchParams;
    const raw = query.get('revision'), revision = Number(raw);
    if ([...query.keys()].some(key => key !== 'revision') || query.getAll('revision').length !== 1 || !/^(0|[1-9][0-9]*)$/.test(raw ?? '') || !Number.isSafeInteger(revision) || revision > Number.MAX_SAFE_INTEGER - 1) throw new HttpError(400, 'Revisión inválida.');
    return NextResponse.json(await readClientFactualFaqAnswer(user, id, topic, revision), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
