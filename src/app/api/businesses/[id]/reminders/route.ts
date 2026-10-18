import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { readAppointmentReminders } from '@/lib/server/appointment-reminders';
import { apiError, HttpError } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta de recordatorios inválida.');
    const id = documentIdSchema.parse((await context.params).id);
    return NextResponse.json(await readAppointmentReminders(user, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
