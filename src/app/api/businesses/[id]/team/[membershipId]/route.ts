import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { teamResponse, readTeamCommand } from '@/lib/server/team-http';
import { teamDocumentIdSchema, teamOwnerDecisionCommandSchema } from '@/lib/business-team';
import { decideTeamAccess } from '@/lib/server/business-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; membershipId: string }> };
export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await requireUser(request), params = await context.params;
    const id = teamDocumentIdSchema.parse(params.id), membershipId = teamDocumentIdSchema.parse(params.membershipId);
    return teamResponse(await decideTeamAccess(actor, id, membershipId, await readTeamCommand(request, teamOwnerDecisionCommandSchema)));
  } catch (error) { return apiError(error); }
}
