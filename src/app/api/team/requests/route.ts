import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { teamResponse, readTeamCommand } from '@/lib/server/team-http';
import { teamSelfRequestCommandSchema } from '@/lib/business-team';
import { requestTeamAccess } from '@/lib/server/business-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const actor = await requireUser(request), command = await readTeamCommand(request, teamSelfRequestCommandSchema);
    return teamResponse(await requestTeamAccess(actor, command));
  } catch (error) { return apiError(error); }
}
