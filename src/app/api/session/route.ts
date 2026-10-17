import { NextResponse } from 'next/server';
import { requireUser, isSuperadmin } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const token = await requireUser(request);
    const admin = isSuperadmin(token.uid);
    return NextResponse.json({ user: { uid: token.uid, email: token.email ?? '', displayName: token.name ?? '' }, isSuperadmin: admin }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
