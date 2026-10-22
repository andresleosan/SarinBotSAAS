import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser, requireSuperadmin } from './auth';
import { currentSupportToken } from './platform-support-core';
import { createSupportConversation, listSupportConversations, readSupportMessages, appendSupportMessage } from './platform-support';
import { configurePlatformSupportRecipient, readPlatformSupportRecipient } from './platform-support-notifications';
import { workUuid } from '../../../shared/platform-whatsapp-work';
import { supportText } from '../../../shared/platform-support-records';
import { apiError, HttpError, readJson } from './http';
const headers = { 'Cache-Control': 'no-store' };
const uuid = z.string().refine(workUuid), revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const create = z.object({ requestId: uuid }).strict();
const message = z.object({ requestId: uuid, expectedRevision: revision, text: z.string().refine(supportText) }).strict();
const recipient = z.object({ linkId: uuid, expectedRevision: revision, requestId: uuid }).strict();
async function auth(request: Request, admin: boolean) { const user = await (admin ? requireSuperadmin : requireUser)(request); await currentSupportToken(user, admin ? 'admin' : 'customer'); return user; }
function query(request: Request, cursor = false) {
  const values = [...new URL(request.url).searchParams];
  if (values.length > (cursor ? 1 : 0) || values.some(([k, v]) => k !== 'cursor' || !v || v.length > 2048)) throw new HttpError(400, 'Consulta no válida.');
  return values[0]?.[1] ?? null;
}
export const supportCollectionHandlers = (admin: boolean) => ({
  GET: async (request: Request) => { try { const user = await auth(request, admin), cursor = query(request, true); return NextResponse.json(await listSupportConversations({ uid: user.uid, role: admin ? 'admin' : 'customer' }, cursor), { headers }); } catch (e) { return apiError(e); } },
  POST: async (request: Request) => { try { const user = await auth(request, false); query(request); const input = await readJson(request, create, 32768); return NextResponse.json(await createSupportConversation(user.uid, input.requestId), { headers }); } catch (e) { return apiError(e); } },
});
type Context = { params: Promise<{ id: string }> };
export const supportMessageHandlers = (admin: boolean) => ({
  GET: async (request: Request, context: Context) => { try { const user = await auth(request, admin), cursor = query(request, true), { id } = await context.params; return NextResponse.json(await readSupportMessages({ uid: user.uid, role: admin ? 'admin' : 'customer' }, id, cursor), { headers }); } catch (e) { return apiError(e); } },
  POST: async (request: Request, context: Context) => { try { const user = await auth(request, admin); query(request); const { id } = await context.params, input = await readJson(request, message, 32768); return NextResponse.json(await appendSupportMessage({ uid: user.uid, role: admin ? 'admin' : 'customer' }, id, input), { headers }); } catch (e) { return apiError(e); } },
});
export const supportNotificationHandlers = {
  GET: async (request: Request) => { try { const user = await auth(request, true); query(request); return NextResponse.json(await readPlatformSupportRecipient(user), { headers }); } catch (e) { return apiError(e); } },
  PATCH: async (request: Request) => { try { const user = await auth(request, true); query(request); const input = await readJson(request, recipient, 32768); return NextResponse.json(await configurePlatformSupportRecipient(user, input), { headers }); } catch (e) { return apiError(e); } },
};