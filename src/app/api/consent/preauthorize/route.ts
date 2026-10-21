import { NextResponse } from 'next/server';
import { consentDocuments, preauthorizationSchema, preauthorizeAccount } from '@/lib/server/consent';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { getCanonicalBookingUrl } from '@/lib/server/booking-url';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ documents: consentDocuments('account') }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin) {
      const configuredOrigin = process.env.SARIN_PUBLIC_BOOKING_ORIGIN ? new URL(getCanonicalBookingUrl('sarin-permisos')).origin : null;
      if (!configuredOrigin && process.env.NODE_ENV === 'production') throw new HttpError(503, 'Configura el origen público de SarinBot para registrar autorizaciones.');
      let sameHost = false;
      try {
        const browserOrigin = new URL(origin);
        // Pages rewrites the backend Host; use the existing canonical public
        // origin, never untrusted forwarded headers. Host is a development-only
        // fallback for Next's internal localhost URL, without cookies or identity.
        const target = new URL(`${browserOrigin.protocol}//${request.headers.get('host') ?? new URL(request.url).host}`);
        sameHost = configuredOrigin ? origin === configuredOrigin : ['https:', 'http:'].includes(browserOrigin.protocol) && browserOrigin.origin === origin && browserOrigin.host === target.host;
      } catch { /* Reject malformed and opaque origins. */ }
      if (!sameHost) throw new HttpError(403, 'Origen no autorizado.');
    }
    return NextResponse.json(preauthorizeAccount(await readJson(request, preauthorizationSchema, 1024)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
