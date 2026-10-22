import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { assertPaymentActor, confirmPaymentAction, confirmPaymentSchema, paymentActionResult, paymentUuidSchema } from '@/lib/server/admin-payment-actions';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireSuperadmin(request);
    await assertPaymentActor(actor, true);
    if (new URL(request.url).search) throw new HttpError(400, 'Consulta no válida.');
    const id = paymentUuidSchema.parse((await context.params).id), input = await readJson(request, confirmPaymentSchema, 1024);
    return NextResponse.json(paymentActionResult(await confirmPaymentAction(actor, id, input)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
