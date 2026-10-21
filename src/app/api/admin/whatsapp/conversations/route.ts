import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { getWhatsAppConversations, setWhatsAppConversationMode, whatsAppConversationControlSchema } from '@/lib/server/whatsapp-conversations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  try {
    await requireSuperadmin(request);
    return NextResponse.json(await getWhatsAppConversations(), { headers });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    const input = await readJson(request, whatsAppConversationControlSchema, 2048);
    return NextResponse.json({ conversation: await setWhatsAppConversationMode(input, user.uid) }, { headers });
  } catch (error) { return apiError(error); }
}
