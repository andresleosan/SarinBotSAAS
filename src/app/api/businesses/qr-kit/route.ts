import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError } from '@/lib/server/http';
import { getOwnedBusiness } from '@/lib/server/businesses';
import { AGENDIA_PUBLIC_ORIGIN, getCanonicalBookingUrl } from '@/lib/server/booking-url';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'application') || query.getAll('application').length > 1 || (query.has('application') && query.get('application') !== 'agendia')) throw new HttpError(400, 'Aplicación no autorizada.');
    const business = await getOwnedBusiness(user.uid);
    if (!business?.sarinConfig.onboardingCompleted || !business.slug) throw new HttpError(409, 'Completa primero los datos de tu negocio.', 'BUSINESS_NOT_READY');
    const bookingUrl = getCanonicalBookingUrl(business.slug, query.get('application') === 'agendia' ? AGENDIA_PUBLIC_ORIGIN : undefined);
    return NextResponse.json({ business, bookingUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
