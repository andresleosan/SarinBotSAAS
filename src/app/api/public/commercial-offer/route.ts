import { NextResponse } from 'next/server';
import { readPublicCommercialOffer } from '@/lib/server/commercial-offer';
import { apiError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readPublicCommercialOffer(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
