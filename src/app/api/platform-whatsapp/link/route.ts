import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/server/auth';
import { apiError, HttpError, readJson } from '@/lib/server/http';
import { requestIdSchema } from '@/lib/server/schemas';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { beginPlatformWhatsAppLink, confirmPlatformWhatsAppLink, readPlatformWhatsAppLinkStatus, revokePlatformWhatsAppLink } from '@/lib/server/platform-whatsapp-link';
import { LINK_UUID } from '../../../../../shared/platform-whatsapp-link-records';
import { isPlatformWhatsAppScope, PLATFORM_PHONE_PATTERN } from '../../../../../shared/platform-whatsapp-records';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
// The shared request grammar's legacy dollar anchor also accepts a final newline.
const requestId = requestIdSchema.refine(value => /^[A-Za-z0-9_-]{8,128}(?![\s\S])/.test(value));
const issueRequestId = requestId.refine(value => !value.startsWith('revoke_v1_'));
const postSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('begin'), phoneE164: z.string().regex(PLATFORM_PHONE_PATTERN), requestId: issueRequestId }).strict(),
  z.object({ action: z.literal('confirm'), challengeId: z.string().regex(LINK_UUID), requestId: issueRequestId, confirmed: z.literal(true) }).strict(),
]);
const deleteSchema = z.object({ requestId: requestId.refine(value => {
  const parts = /^revoke_v1_([0-9a-f-]{36})_([0-9a-f-]{36})(?![\s\S])/.exec(value);
  return !!parts && LINK_UUID.test(parts[1]) && LINK_UUID.test(parts[2]);
}) }).strict();
function rejectQuery(request: Request) {
  if (!new URL(request.url).searchParams.entries().next().done) throw new HttpError(400, 'Datos no válidos. Revisa los campos enviados.');
}
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    rejectQuery(request);
    return NextResponse.json(await readPlatformWhatsAppLinkStatus(user), { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    rejectQuery(request);
    const body = await readJson(request, postSchema, 2048);
    if (body.action === 'confirm') return NextResponse.json(await confirmPlatformWhatsAppLink(user, { challengeId: body.challengeId, requestId: body.requestId }), { headers });
    const result = await beginPlatformWhatsAppLink(user, { phoneE164: body.phoneE164, requestId: body.requestId });
    const scope = getPlatformWhatsAppConfig().scope;
    return NextResponse.json({ ...result, ...(isPlatformWhatsAppScope(scope) ? { whatsappUrl: 'https://wa.me/' + scope.phoneE164.slice(1) } : {}) }, { headers });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    const user = await requireUser(request);
    rejectQuery(request);
    const body = await readJson(request, deleteSchema, 2048);
    await revokePlatformWhatsAppLink(user, body.requestId);
    return NextResponse.json({ revoked: true }, { headers });
  } catch (error) { return apiError(error); }
}
