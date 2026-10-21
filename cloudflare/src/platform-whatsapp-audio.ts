import { AUDIO_ENDPOINT, AUDIO_REQUEST_BYTES, AUDIO_READ_MS, AudioError, AudioOperation, audioLease, audioText, discardAudioBody, readAudioBytes, type AudioReason, type InternalAudioResult } from '../../shared/platform-whatsapp-audio-protocol.ts';
import { validatePlatformAudioDescriptor } from '../../shared/platform-whatsapp-audio.ts';
import { decodeAudioBase64, audioBase64, decryptPlatformWorkerContent, platformWorkerDigest } from '../../shared/platform-whatsapp-worker-crypto.ts';
import { parsePlatformWorkPolicy, platformCost } from '../../shared/platform-whatsapp-policy.ts';
import { emptyUsage, workExact, workObject, type Lease } from '../../shared/platform-whatsapp-work.ts';
import { PLATFORM_PHONE_PATTERN } from '../../shared/platform-whatsapp-records.ts';
import { preparePlatformAudio, startPlatformAudio, finishPlatformAudio } from './platform-whatsapp-work-stages.ts';
import { MAX_AUDIO_BYTES, verifiedOpusSamples } from './platform-whatsapp-opus.ts';
import { SINGLETON_NAME } from './router.ts';

type Env = Pick<CloudflareBindings, 'SARIN_DB' | 'SARIN_FILES' | 'SARIN_APP' | 'AI'> & PlatformWhatsAppBindings;
const reply = (result: InternalAudioResult, status = 200, headers = {}) => Response.json(result, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
const failure = (reason: AudioReason, status = 200, headers = {}) => reply({ ok: false, reason }, status, headers);
const reject = (reason: AudioReason): never => { throw new AudioError(reason); };
function exactBinding(value: unknown, expected: unknown): boolean {
  if (!workObject(expected)) return value === expected;
  return workObject(value) && workExact(value, Object.keys(expected)) && Object.keys(expected).every(k => exactBinding(value[k], expected[k]));
}

/** Sole private Worker adapter. Caller identity is checked before URL/body/bindings. */
export async function handlePlatformAudioOutbound(request: Request, env: Env, ctx: { containerId: string; className: string }): Promise<Response> {
  if (ctx.className !== 'SarinApp' || ctx.containerId !== env.SARIN_APP.idFromName(SINGLETON_NAME).toString()) return failure('denied', 403);
  if (request.url !== AUDIO_ENDPOINT) return failure('denied', 403);
  if (request.method !== 'POST') return failure('denied', 405, { Allow: 'POST' });
  const operation = new AudioOperation(request.signal);
  let lease: Lease | undefined, prepared: Awaited<ReturnType<typeof preparePlatformAudio>> = null;
  let startAttempted = false, finishing = false;
  try {
    let body: unknown;
    try {
      const bytes = await operation.wait(readAudioBytes(request.body, AUDIO_REQUEST_BYTES, operation), AUDIO_READ_MS);
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes));
    } catch (error) { return failure(error instanceof AudioError && error.reason === 'limit' ? 'limit' : error instanceof AudioError && error.reason === 'unknown' ? 'unknown' : 'denied', error instanceof AudioError && error.reason === 'limit' ? 413 : error instanceof AudioError && error.reason === 'unknown' ? 503 : 400); }
    if (!audioLease(body)) return failure('denied', 400); lease = body;
    const policy = parsePlatformWorkPolicy(env);
    if (!policy?.enabled.audio || policy.limits.audio <= 0 || policy.tariff.audio.numerator <= 0 || !env.PLATFORM_YCLOUD_API_KEY?.trim() || !env.AI || typeof env.AI.run !== 'function') return failure('denied');
    try { decodeAudioBase64(env.PLATFORM_WHATSAPP_CONTENT_KEY, 32); } catch { return failure('denied'); }
    operation.check(); prepared = await operation.wait(preparePlatformAudio(lease, env, Date.now()));
    if (!prepared) return failure('denied');
    operation.restrict(Math.min(prepared.processingDeadlineAt, prepared.bodyExpiresAt));
    let payload: unknown;
    try { payload = await operation.wait(decryptPlatformWorkerContent(prepared.sourceEnvelope, prepared.sourceEventPath, env.PLATFORM_WHATSAPP_CONTENT_KEY!)); }
    catch (error) { if (error instanceof AudioError) throw error; return reject('denied'); }
    const binding = prepared.sourceBinding;
    if (!workObject(payload) || !workExact(payload, ['customerPhone', 'audio', 'retentionAnchor']) || typeof payload.customerPhone !== 'string' || !PLATFORM_PHONE_PATTERN.test(payload.customerPhone) || payload.customerPhone === binding.scope.phoneE164 || !exactBinding(payload.retentionAnchor, binding.retentionAnchor) || binding.scope.wabaId !== env.PLATFORM_WHATSAPP_WABA_ID || binding.scope.phoneE164 !== env.PLATFORM_WHATSAPP_PHONE_E164 || binding.scope.phoneNumberId !== env.PLATFORM_WHATSAPP_PHONE_NUMBER_ID) reject('denied');
    const source = payload as Record<string, unknown>;
    const digest = await operation.wait(platformWorkerDigest('conversation', [binding.scope.wabaId, binding.scope.phoneE164, binding.scope.phoneNumberId, source.customerPhone as string], env.PLATFORM_WHATSAPP_CONTENT_KEY!));
    if (digest !== binding.conversationId) reject('denied');
    const descriptor = validatePlatformAudioDescriptor(source.audio); if (!descriptor) return reject('invalid_audio');
    operation.check();
    const download = fetch(descriptor.link, { method: 'GET', headers: { 'X-API-Key': env.PLATFORM_YCLOUD_API_KEY! }, redirect: 'manual', signal: operation.controller.signal });
    // A cancellation-ignoring transport may still return a body after the race.
    void download.then(response => { if (operation.controller.signal.aborted) discardAudioBody(response.body); }, () => {});
    const response = await operation.wait(download);
    let bytes: Uint8Array;
    try {
      if (response.status !== 200 || response.redirected || response.url !== descriptor.link || response.headers.has('Content-Encoding') || response.headers.has('Content-Range') || !validatePlatformAudioDescriptor({ ...descriptor, mimeType: response.headers.get('Content-Type') })) reject('invalid_audio');
      const declared = response.headers.get('Content-Length');
      if (declared !== null) { if (!/^(0|[1-9][0-9]*)$/.test(declared) || !Number.isSafeInteger(Number(declared))) reject('invalid_audio'); if (Number(declared) > MAX_AUDIO_BYTES) reject('limit'); }
      bytes = await readAudioBytes(response.body, MAX_AUDIO_BYTES, operation);
    } finally { discardAudioBody(response.body); }
    const hash = await operation.wait(crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
    if (audioBase64(new Uint8Array(hash)) !== descriptor.sha256) reject('invalid_audio');
    const samples = verifiedOpusSamples(bytes, () => operation.check()), milliseconds = Math.ceil(samples / 48);
    const actualMicros = platformCost([{ units: milliseconds, rate: policy.tariff.audio }]);
    operation.check(); startAttempted = true;
    const started = await operation.wait(startPlatformAudio(lease, prepared.audioToken, env, Date.now()));
    if (!started) { startAttempted = false; reject('denied'); }
    operation.check();
    const result: unknown = await operation.wait(env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: audioBase64(bytes), task: 'transcribe' }));
    const text = workObject(result) && typeof result.text === 'string' ? result.text.trim() : null;
    const valid = audioText(text);
    operation.check(); finishing = true;
    const pending = await operation.wait(finishPlatformAudio(lease, prepared.audioToken, { status: valid ? 'completed' : 'failed', actualMicros, usage: { ...emptyUsage, usageAudioMilliseconds: milliseconds } }, env, Date.now()));
    if (!valid) return failure('invalid_audio');
    if (!pending) return failure('denied');
    return reply({ ok: true, audioToken: prepared.audioToken, text, durationSeconds: samples / 48000 });
  } catch (error) {
    const reason = error instanceof AudioError ? error.reason : 'unknown';
    if (lease && prepared && !finishing) {
      finishing = true;
      // Cleanup may commit after cancellation; it can never grant a new effect.
      try { await operation.wait(finishPlatformAudio(lease, prepared.audioToken, { status: reason === 'unknown' ? 'unknown' : 'failed', actualMicros: startAttempted ? null : 0, usage: emptyUsage }, env, Date.now())); } catch { /* Preserve durable uncertainty; never retry inference. */ }
    }
    return failure(reason, error instanceof AudioError ? 200 : 503);
  } finally { operation.close(); }
}
