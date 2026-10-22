import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { assertPaymentActor, paymentUuidSchema, preparePaymentAction, preparePaymentSchema, readPaymentAction } from '@/lib/server/admin-payment-actions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const actor = await requireSuperadmin(request);
    await assertPaymentActor(actor);
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].length !== 1 || query.getAll('id').length !== 1) throw new HttpError(400, 'Selecciona una sola propuesta.');
    return NextResponse.json(await readPaymentAction(actor, paymentUuidSchema.parse(query.get('id'))), { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireSuperadmin(request);
    await assertPaymentActor(actor);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta no válida.');
    const input = await readJson(request, preparePaymentSchema, 4096);
    const proposal = await preparePaymentAction(actor, input);
    return NextResponse.json(await readPaymentAction(actor, proposal.id), { headers });
  } catch (error) { return apiError(error); }
}
