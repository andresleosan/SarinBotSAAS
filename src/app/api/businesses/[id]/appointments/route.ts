import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { getAdminDb } from '@/lib/firebase/admin';
import { blockSchema, cancelSchema, dateKeySchema, documentIdSchema } from '@/lib/server/schemas';
import { cancelAppointment, createManualBlock, readAppointments } from '@/lib/server/bookings';
import type { Appointment } from '@/types/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request);
    const id = documentIdSchema.parse((await context.params).id);
    const parameters = new URL(request.url).searchParams;
    if ([...parameters.keys()].some(key => !['date', 'view'].includes(key)) || parameters.getAll('date').length > 1 || parameters.getAll('view').length > 1) throw new HttpError(400, 'Consulta de citas inválida.');
    if (parameters.has('view')) {
      if (parameters.get('view') !== 'mine' || parameters.has('date')) throw new HttpError(400, 'Consulta de citas inválida.');
      const db = getAdminDb();
      if (!(await db.collection('businesses').doc(id).get()).exists) throw new HttpError(404, 'El negocio no existe.');
      // This view deliberately includes all history and future visits; no hidden result cap.
      const snapshot = await db.collection('businesses').doc(id).collection('appointments').where('client.uid', '==', user.uid).get();
      const appointments = snapshot.docs.map(document => ({ ...document.data(), id: document.id }) as Appointment)
        .filter(item => item.tenantId === id && item.type === 'appointment' && item.client?.uid === user.uid)
        .sort((left, right) => left.startAt - right.startAt || left.id.localeCompare(right.id));
      return NextResponse.json({ appointments }, { headers });
    }
    const dateKey = dateKeySchema.parse(parameters.get('date'));
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
