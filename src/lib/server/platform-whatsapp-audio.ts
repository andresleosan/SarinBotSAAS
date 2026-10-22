import 'server-only';
import { getAdminDb } from '@/lib/firebase/admin';
import { createPlatformWorkStore } from './platform-whatsapp-work-store';
import { commitPlatformAudioResult } from './platform-whatsapp-work-audio';
import { currentPlatformWorkPolicy, reservePlatformCost } from './platform-whatsapp-budget';
import { maximumPlatformCost } from '../../../shared/platform-whatsapp-policy';
import { AUDIO_ENDPOINT, AUDIO_RESPONSE_BYTES, AudioError, AudioOperation, audioLease, discardAudioBody, internalAudioResult, readAudioBytes, type AudioResult } from '../../../shared/platform-whatsapp-audio-protocol';
import type { Lease } from '../../../shared/platform-whatsapp-work';

/** Lease-only bridge. A5 owns renewal; success requires fresh Firebase and D1. */
export async function transcribePlatformAudio(lease: Lease, signal: AbortSignal): Promise<AudioResult> {
  const operation = new AudioOperation(signal);
  try {
    if (!audioLease(lease)) return { ok: false, reason: 'denied' };
    operation.check(); const db = getAdminDb();
    const job = await operation.wait(createPlatformWorkStore(db).readAuthorized(lease));
    if (!job || job.sourceKind !== 'audio' || job.audioState !== 'not_started' || job.windowExpiresAt === null || job.processingDeadlineAt === null) return { ok: false, reason: 'denied' };
    operation.restrict(Math.min(job.bodyExpiresAt, job.windowExpiresAt, job.processingDeadlineAt!));
    const { policy } = currentPlatformWorkPolicy();
    if (!policy.enabled.audio || policy.limits.audio <= 0 || policy.tariff.audio.numerator <= 0) return { ok: false, reason: 'denied' };
    await operation.wait(reservePlatformCost(job.jobId, 'audio', maximumPlatformCost(policy, 'audio'), db));
    operation.check();
    if (!await operation.wait(createPlatformWorkStore(db).readAuthorized(lease))) return { ok: false, reason: 'denied' };
    const transport = fetch(AUDIO_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lease), redirect: 'manual', signal: operation.controller.signal });
    void transport.then(response => { if (operation.controller.signal.aborted) discardAudioBody(response.body); }, () => {});
    const response = await operation.wait(transport);
    if (!response.ok) { discardAudioBody(response.body); return { ok: false, reason: [400, 403, 405].includes(response.status) ? 'denied' : response.status === 413 ? 'limit' : 'unknown' }; }
    const bytes = await readAudioBytes(response.body, AUDIO_RESPONSE_BYTES, operation);
    const result: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    if (!internalAudioResult(result)) return { ok: false, reason: 'unknown' };
    if (!result.ok) return result;
    operation.check();
    const committed = await operation.wait(commitPlatformAudioResult(lease, result.audioToken, result.text, result.durationSeconds, db, Date.now()));
    return committed ? { ok: true, text: result.text, durationSeconds: result.durationSeconds } : { ok: false, reason: 'denied' };
  } catch (error) {
    return { ok: false, reason: error instanceof AudioError && error.reason === 'denied' || (error instanceof Error && 'code' in error && error.code === 'PLATFORM_WORK_CLOSED') ? 'denied' : 'unknown' };
  } finally { operation.close(); }
}
