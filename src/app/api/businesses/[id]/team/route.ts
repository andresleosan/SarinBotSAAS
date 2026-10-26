import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { teamQuery, teamResponse } from '@/lib/server/team-http';
import { teamDocumentIdSchema, teamRequestIdSchema } from '@/lib/business-team';
import { readOwnerBusinessTeam } from '@/lib/server/business-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireUser(request), id = teamDocumentIdSchema.parse((await context.params).id), query = teamQuery(request, ['requestId']);
    const requestId = query.has('requestId') ? teamRequestIdSchema.parse(query.get('requestId')) : undefined;
    return teamResponse(await readOwnerBusinessTeam(actor, id, requestId));
  } catch (error) { return apiError(error); }
}
