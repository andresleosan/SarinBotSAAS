import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { blockSchema, cancelSchema, dateKeySchema, documentIdSchema } from '@/lib/server/schemas';
import { cancelAppointment, createManualBlock, readAppointments } from '@/lib/server/bookings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    const id = documentIdSchema.parse((await context.params).id);
    const dateKey = dateKeySchema.parse(new URL(request.url).searchParams.get('date'));
    return NextResponse.json({ appointments: await readAppointments(id, dateKey, user) }, { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    const id = documentIdSchema.parse((await context.params).id);
    const input = await readJson(request, blockSchema);
    return NextResponse.json({ appointment: await createManualBlock(user, id, input) }, { status: 201, headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    const id = documentIdSchema.parse((await context.params).id);
    const input = await readJson(request, cancelSchema);
    return NextResponse.json({ appointment: await cancelAppointment(user, id, input.appointmentId) }, { headers });
  } catch (error) { return apiError(error); }
}
