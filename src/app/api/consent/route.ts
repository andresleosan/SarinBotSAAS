import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import type { ConsentBusiness } from '@/lib/legal';
import { requireUser } from '@/lib/server/auth';
import { consentInputSchema, readConsent, updateConsent } from '@/lib/server/consent';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { documentIdSchema } from '@/lib/server/schemas';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const querySchema = z.object({ scope: z.enum(['account', 'business_client']), businessId: documentIdSchema.optional() }).strict().refine(value => value.scope === 'business_client' ? Boolean(value.businessId) : value.businessId === undefined);
export async function GET(request: Request) {
  try {
    const user = await requireUser(request), db = getAdminDb(), query = new URL(request.url).searchParams;
    const parsed = querySchema.safeParse({ scope: query.get('scope') ?? 'account', ...(query.has('businessId') ? { businessId: query.get('businessId') } : {}) });
    if (!parsed.success) throw new HttpError(400, 'Ámbito de autorización inválido.');
    const business = parsed.data.businessId ? (await db.collection('businesses').doc(parsed.data.businessId).get()).data() as ConsentBusiness | undefined : undefined;
    if (parsed.data.businessId && !business) throw new HttpError(404, 'El negocio no existe.');
    return NextResponse.json(await readConsent(user.uid, parsed.data.scope, business, db), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    return NextResponse.json(await updateConsent(user, await readJson(request, consentInputSchema, 4096)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
