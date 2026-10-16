import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { chatSchema } from '@/lib/server/schemas';
import { runSarinChat } from '@/lib/server/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const token = await requireUser(request);
    const body = await readJson(request, chatSchema, 96 * 1024);
    const response = await runSarinChat({ user: { uid: token.uid, email: token.email, name: typeof token.name === 'string' ? token.name : undefined }, body, signal: request.signal, channel: 'web' });
    return NextResponse.json(response, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
