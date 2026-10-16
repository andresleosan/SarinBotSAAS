import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { publicBusiness } from '@/lib/server/businesses';
import { apiError, HttpError } from '@/lib/server/http';
import type { Business } from '@/types/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 70) throw new HttpError(400, 'Enlace de negocio inválido.');
    // Never fall back to the private businesses collection, even for malformed/missing projections.
    const document = await getAdminDb().collection('publicBusinesses').doc(slug).get();
    const business = document.exists ? publicBusiness(document.data() as Business) : null;
    return NextResponse.json({ business }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
