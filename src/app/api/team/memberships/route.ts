import { requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { teamQuery, teamResponse } from '@/lib/server/team-http';
import { readOwnTeamMemberships } from '@/lib/server/business-team';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const actor = await requireUser(request), query = teamQuery(request, ['afterBusinessId', 'businessSlug', 'requestId']);
    return teamResponse(await readOwnTeamMemberships(actor, Object.fromEntries(query)));
  } catch (error) { return apiError(error); }
}
