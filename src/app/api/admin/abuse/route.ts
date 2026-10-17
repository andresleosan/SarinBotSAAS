import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperadmin } from '@/lib/server/auth';
import { readAdminAiBudget, readBusinessAiBudget, saveBusinessAiBudgetSettings, businessAiBudgetInputSchema, saveAiBudgetSettings, reconcilePaidCallBudget, aiBudgetSettingsInputSchema, aiBudgetReconcileSchema } from '@/lib/server/ai-budget';
import { documentIdSchema } from '@/lib/server/schemas';
import { apiError, HttpError, readJson } from '@/lib/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.discriminatedUnion('action', [aiBudgetSettingsInputSchema.extend({ action: z.literal('configure') }), aiBudgetReconcileSchema.extend({ action: z.literal('reconcile') }), businessAiBudgetInputSchema.extend({ action: z.literal('configure_business') })]);
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const admin = await requireSuperadmin(request), query = new URL(request.url).searchParams;
    if (query.has('businessId')) {
      if ([...query.keys()].some(key => key !== 'businessId') || query.getAll('businessId').length !== 1) throw new HttpError(400, 'Consulta inválida.');
      return NextResponse.json(await readBusinessAiBudget(admin, documentIdSchema.parse(query.get('businessId'))), { headers });
    }
    if ([...query.keys()].some(key => key !== 'cursor') || query.getAll('cursor').length > 1) throw new HttpError(400, 'Consulta inválida.');
    return NextResponse.json(await readAdminAiBudget(admin, undefined, query.has('cursor') ? z.string().uuid().parse(query.get('cursor')) : undefined), { headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const admin = await requireSuperadmin(request), input = await readJson(request, schema, 8192);
    if (input.action === 'configure_business') {
      const { action: _action, ...settings } = input;
      await saveBusinessAiBudgetSettings(admin, settings);
      return NextResponse.json(await readBusinessAiBudget(admin, input.businessId), { headers });
    }
    if (input.action === 'configure') { const { action: _action, ...settings } = input; await saveAiBudgetSettings(admin, settings); }
    else { const { action: _action, ...reconciliation } = input; await reconcilePaidCallBudget(admin, reconciliation); }
    return NextResponse.json(await readAdminAiBudget(admin), { headers });
  } catch (error) { return apiError(error); }
}
