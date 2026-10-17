import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { getBusiness } from '@/lib/server/businesses';
import { readBookingDataPolicy } from '@/lib/server/booking-data-policy';
import { apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser(request); if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const { id } = await context.params; await getBusiness(id);
    return NextResponse.json((await readBookingDataPolicy(id)).capability, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
