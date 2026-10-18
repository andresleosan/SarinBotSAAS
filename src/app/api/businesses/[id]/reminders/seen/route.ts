import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { documentIdSchema } from '@/lib/server/schemas';
import { markAppointmentReminderSeen, reminderOccurrenceSchema } from '@/lib/server/appointment-reminders';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta de recordatorios inválida.');
    const id = documentIdSchema.parse((await context.params).id), input = await readJson(request, reminderOccurrenceSchema, 4096);
    return NextResponse.json(await markAppointmentReminderSeen(user, id, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
