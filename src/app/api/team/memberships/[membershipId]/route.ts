import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { teamResponse, readTeamCommand } from '@/lib/server/team-http';
import { teamDocumentIdSchema, teamLeaveCommandSchema } from '@/lib/business-team';
import { leaveTeamAccess } from '@/lib/server/business-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ membershipId: string }> };
export async function DELETE(request: Request, context: Context) {
  try {
    const actor = await requireUser(request), membershipId = teamDocumentIdSchema.parse((await context.params).membershipId);
    return teamResponse(await leaveTeamAccess(actor, membershipId, await readTeamCommand(request, teamLeaveCommandSchema)));
  } catch (error) { return apiError(error); }
}
