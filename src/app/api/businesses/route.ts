import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { businessConfigSchema } from '@/lib/server/schemas';
import { createBusiness, getOwnedBusiness } from '@/lib/server/businesses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json({ business: await getOwnedBusiness(user.uid) }, { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const config = await readJson(request, businessConfigSchema, 64 * 1024);
    return NextResponse.json({ business: await createBusiness(user, config) }, { status: 201, headers });
  } catch (error) { return apiError(error); }
}
