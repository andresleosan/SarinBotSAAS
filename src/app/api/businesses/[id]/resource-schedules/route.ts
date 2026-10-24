import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { resourceScheduleCommandSchema, scheduleBusinessIdSchema, scheduleRequestIdSchema, readOwnerResourceSchedules, saveOwnerResourceSchedules } from '@/lib/server/resource-schedules';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser(request), businessId = scheduleBusinessIdSchema.parse((await context.params).id);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'requestId') || query.getAll('requestId').length > 1) throw new HttpError(400, 'Consulta inválida.');
    const requestId = query.has('requestId') ? scheduleRequestIdSchema.parse(query.get('requestId')) : undefined;
    return NextResponse.json(await readOwnerResourceSchedules(user, businessId, requestId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
export async function PUT(request: Request, context: Context) {
  try {
    const user = await requireUser(request), businessId = scheduleBusinessIdSchema.parse((await context.params).id);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta inválida.');
    const command = await readJson(request, resourceScheduleCommandSchema, 128 * 1024);
    return NextResponse.json(await saveOwnerResourceSchedules(user, businessId, command), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
