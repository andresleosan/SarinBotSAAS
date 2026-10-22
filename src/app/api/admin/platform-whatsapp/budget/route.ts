import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { platformBudgetInput, readPlatformAdminBudget, savePlatformAdminBudget } from '@/lib/server/platform-whatsapp-admin-budget';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try { const actor = await requireSuperadmin(request); return NextResponse.json(await readPlatformAdminBudget(actor.uid), { headers }); }
  catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try { const actor = await requireSuperadmin(request); const input = await readJson(request, platformBudgetInput, 1024); return NextResponse.json(await savePlatformAdminBudget(actor.uid, input), { headers }); }
  catch (error) { return apiError(error); }
}
