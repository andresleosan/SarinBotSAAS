import { NextResponse } from 'next/server';
import { consentDocuments, preauthorizationSchema, preauthorizeAccount } from '@/lib/server/consent';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ documents: consentDocuments('account') }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin) {
      let sameHost = false;
      try {
        const browserOrigin = new URL(origin);
        // Next can construct request.url with its internal localhost hostname.
        // This stateless public endpoint uses the actual target Host; no cookies
        // or identity are accepted and authenticated claiming is a separate API.
        const target = new URL(`${browserOrigin.protocol}//${request.headers.get('host') ?? new URL(request.url).host}`);
        sameHost = ['https:', 'http:'].includes(browserOrigin.protocol) && browserOrigin.origin === origin && browserOrigin.host === target.host;
      } catch { /* Reject malformed and opaque origins. */ }
      if (!sameHost) throw new HttpError(403, 'Origen no autorizado.');
    }
    return NextResponse.json(preauthorizeAccount(await readJson(request, preauthorizationSchema, 1024)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
