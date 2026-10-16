import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { redeemInvitationSchema } from '@/lib/server/invitation-schemas';
import { redeemInvitation } from '@/lib/server/invitations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const result = await redeemInvitation(user, await readJson(request, redeemInvitationSchema, 2048));
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
