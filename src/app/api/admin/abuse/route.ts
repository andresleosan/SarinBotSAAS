import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperadmin } from '@/lib/server/auth';
import { readAdminAiBudget, saveAiBudgetSettings, reconcilePaidCallBudget, aiBudgetSettingsInputSchema, aiBudgetReconcileSchema } from '@/lib/server/ai-budget';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.discriminatedUnion('action', [aiBudgetSettingsInputSchema.extend({ action: z.literal('configure') }), aiBudgetReconcileSchema.extend({ action: z.literal('reconcile') })]);
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const admin = await requireSuperadmin(request), query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'cursor') || query.getAll('cursor').length > 1) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await readAdminAiBudget(admin, undefined, query.has('cursor') ? z.string().uuid().parse(query.get('cursor')) : undefined), { headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const admin = await requireSuperadmin(request), input = await readJson(request, schema, 8192);
    if (input.action === 'configure') { const { action: _action, ...settings } = input; await saveAiBudgetSettings(admin, settings); }
    else { const { action: _action, ...reconciliation } = input; await reconcilePaidCallBudget(admin, reconciliation); }
    return NextResponse.json(await readAdminAiBudget(admin), { headers });
  } catch (error) { return apiError(error); }
}
