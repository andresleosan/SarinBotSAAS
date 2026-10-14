import { NextResponse } from 'next/server';
import { requireUser, isSuperadmin } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { getAdminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const token = await requireUser(request);
    const admin = isSuperadmin(token.uid);
    const ref = getAdminDb().collection('users').doc(token.uid);
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.get('isSuperadmin') !== admin) {
      await ref.set({ uid: token.uid, email: token.email ?? '', displayName: token.name ?? '', role: admin ? 'superadmin' : 'user', isSuperadmin: admin,
        ...(!snapshot.exists ? { visitedTenants: [], createdAt: Date.now() } : {}) }, { merge: true });
    }
    return NextResponse.json({ user: { uid: token.uid, email: token.email ?? '', displayName: token.name ?? '' }, isSuperadmin: admin }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
