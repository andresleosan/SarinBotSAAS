import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { bookingSubjectConsentInputSchema, bookingSubjectConsentQuerySchema, readBookingSubjectConsent, updateBookingSubjectConsent } from '@/lib/server/booking-subject-consent';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireUser(request), query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => !['businessId', 'bookingRequestId', 'subjectKind', 'representativeRole'].includes(key) || query.getAll(key).length !== 1)) throw new HttpError(400, 'Consulta inválida.');
    const { businessId, ...subjectCase } = Object.fromEntries(query), input = bookingSubjectConsentQuerySchema.parse({ businessId, case: subjectCase });
    return NextResponse.json(await readBookingSubjectConsent(user, input.businessId, input.case), { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await updateBookingSubjectConsent(user, await readJson(request, bookingSubjectConsentInputSchema, 8192)), { headers });
  } catch (error) { return apiError(error); }
}
