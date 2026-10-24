import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { appointmentAttendanceCommandSchema, appointmentAttendanceCursorSchema } from '@/lib/appointment-attendance';
import { readAppointmentAttendanceHistory, updateAppointmentAttendance } from '@/lib/server/appointment-attendance';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; appointmentId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const owner = await requireUser(request);
    const params = await context.params, businessId = documentIdSchema.parse(params.id), appointmentId = documentIdSchema.parse(params.appointmentId);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'beforeRevision') || query.getAll('beforeRevision').length > 1) throw new HttpError(400, 'Consulta inválida.');
    const beforeRevision = query.has('beforeRevision') ? appointmentAttendanceCursorSchema.parse(query.get('beforeRevision')) : undefined;
    return NextResponse.json(await readAppointmentAttendanceHistory(owner, businessId, appointmentId, beforeRevision), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const owner = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const params = await context.params, businessId = documentIdSchema.parse(params.id), appointmentId = documentIdSchema.parse(params.appointmentId);
    const command = await readJson(request, appointmentAttendanceCommandSchema, 2048);
    return NextResponse.json(await updateAppointmentAttendance(owner, businessId, appointmentId, command), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
