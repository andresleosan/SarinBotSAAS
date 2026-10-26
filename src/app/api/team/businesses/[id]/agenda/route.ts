import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { teamQuery, teamResponse } from '@/lib/server/team-http';
import { teamDocumentIdSchema } from '@/lib/business-team';
import { readTeamAssignedAgenda } from '@/lib/server/team-agenda';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const actor = await requireUser(request), id = teamDocumentIdSchema.parse((await context.params).id), query = teamQuery(request, ['date']);
    return teamResponse(await readTeamAssignedAgenda(actor, id, query.get('date') ?? ''));
  } catch (error) { return apiError(error); }
}
