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
    if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Origen no autorizado.');
    return NextResponse.json(preauthorizeAccount(await readJson(request, preauthorizationSchema, 1024)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
