import { NextResponse } from 'next/server';
import { getSarinQueueStats } from '@/lib/sarin/queue';
import { probeEngine, type EngineProvider } from '@/lib/sarin/engine';
import { getAiProviderSelection } from '@/lib/server/provider-settings';
import { isSuperadmin, requireUser } from '@/lib/server/auth';
import { apiError, HttpError } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const state = globalThis as typeof globalThis & { __sarinProbes?: Partial<Record<EngineProvider, { expires: number; value: ReturnType<typeof probeEngine> }>> };
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const scope = new URL(request.url).searchParams.get('scope') ?? 'chat';
    if (!['chat', 'engine'].includes(scope)) throw new HttpError(400, 'Consulta de estado no válida.');
    if (scope === 'engine' && !isSuperadmin(user.uid)) throw new HttpError(403, 'Forbidden');
    const provider = scope === 'engine' ? 'ollama' : (await getAiProviderSelection()).provider;
    const probes = state.__sarinProbes ??= {};
    let probe = probes[provider];
    if (!probe || probe.expires < Date.now()) probe = probes[provider] = { expires: Date.now() + 10_000, value: probeEngine(provider) };
    const health = await probe.value;
    return NextResponse.json({ status: health.online ? 'online' : 'offline', ...health,
      ...(isSuperadmin(user.uid) ? { queue: getSarinQueueStats() } : {}),
    }, { status: health.online ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
