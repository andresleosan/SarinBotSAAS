import { NextResponse } from 'next/server';
import { getSarinQueueStats } from '@/lib/sarin/queue';
import { probeEngine } from '@/lib/sarin/engine';
import { isSuperadmin, requireUser } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & { __sarinProbe?: { expires: number; value: ReturnType<typeof probeEngine> } };
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (!state.__sarinProbe || state.__sarinProbe.expires < Date.now()) state.__sarinProbe = { expires: Date.now() + 10_000, value: probeEngine() };
    const health = await state.__sarinProbe.value;
    return NextResponse.json({ status: health.online ? 'online' : 'offline', ...health,
      ...(isSuperadmin(user.uid) ? { queue: getSarinQueueStats() } : {}),
      ...(!health.online ? { error: 'La Mac, Ollama o el túnel no están disponibles.' } : {}),
    }, { status: health.online ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
