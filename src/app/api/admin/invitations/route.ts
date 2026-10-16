import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { createInvitationSchema, invitationCommandSchema, invitationCursorSchema } from '@/lib/server/invitation-schemas';
import { createInvitation, listInvitations, updateInvitation } from '@/lib/server/invitations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'after') || params.getAll('after').length > 1) throw new HttpError(400, 'Consulta no válida.');
    const after = params.has('after') ? invitationCursorSchema.parse(params.get('after')) : undefined;
    return NextResponse.json(await listInvitations(user, after), { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    const result = await createInvitation(user, await readJson(request, createInvitationSchema, 4096));
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    return NextResponse.json(await updateInvitation(user, await readJson(request, invitationCommandSchema, 4096)), { headers });
  } catch (error) { return apiError(error); }
}
