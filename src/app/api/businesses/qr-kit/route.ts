import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError } from '@/lib/server/http';
import { getOwnedBusiness } from '@/lib/server/businesses';
import { getCanonicalBookingUrl } from '@/lib/server/booking-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const business = await getOwnedBusiness(user.uid);
    if (!business?.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(409, 'Completa primero los datos de tu negocio.', 'BUSINESS_NOT_READY');
    return NextResponse.json({ business, bookingUrl: getCanonicalBookingUrl(business.slug) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
