import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { documentIdSchema } from '@/lib/server/schemas';
import { clientPolicyInputSchema, clientUidSchema, readOwnedClientPolicy, updateClientPolicy } from '@/lib/server/client-policy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string }> };
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request, context: Context) {
  try {
    const owner = await requireUser(request), id = documentIdSchema.parse((await context.params).id), query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'clientUid') || query.getAll('clientUid').length > 1) throw new HttpError(400, 'Consulta inválida.');
    const uid = query.has('clientUid') ? clientUidSchema.parse(query.get('clientUid')) : undefined;
    return NextResponse.json({ policy: await readOwnedClientPolicy(owner, id, uid) }, { headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const owner = await requireUser(request), id = documentIdSchema.parse((await context.params).id);
    return NextResponse.json({ policy: await updateClientPolicy(owner, id, await readJson(request, clientPolicyInputSchema, 4096)) }, { headers });
  } catch (error) { return apiError(error); }
}
