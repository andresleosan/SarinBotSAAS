import { workExact, workId, workObject, workUuid, workText, type Lease } from './platform-whatsapp-work.ts';

export const AUDIO_ENDPOINT = 'http://sarin-audio.internal/transcribe';
export const AUDIO_REQUEST_BYTES = 1024;
export const AUDIO_RESPONSE_BYTES = 32768;
export const AUDIO_OPERATION_MS = 45000;
export const AUDIO_READ_MS = 3000;
export type AudioReason = 'invalid_audio' | 'limit' | 'denied' | 'unknown';
export type AudioResult = { ok: true; text: string; durationSeconds: number } | { ok: false; reason: AudioReason };
export type InternalAudioResult = (Extract<AudioResult, { ok: true }> & { audioToken: string }) | Extract<AudioResult, { ok: false }>;
export class AudioError extends Error {
  readonly reason: AudioReason;
  constructor(reason: AudioReason) { super(reason); this.reason = reason; }
}
export function audioLease(value: unknown): value is Lease {
  return workObject(value) && workExact(value, ['jobId', 'epoch', 'token']) && workId(value.jobId, 'job') && workUuid(value.epoch) && workUuid(value.token);
}
export function audioText(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.length > 0 && workText(value, 'question') && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) && [...value].length <= 4096 && new TextEncoder().encode(value).length <= 16384;
}
export function internalAudioResult(value: unknown): value is InternalAudioResult {
  if (!workObject(value)) return false;
  if (value.ok === false) return workExact(value, ['ok', 'reason']) && ['invalid_audio', 'limit', 'denied', 'unknown'].includes(value.reason as string);
  return value.ok === true && workExact(value, ['ok', 'audioToken', 'text', 'durationSeconds']) && workUuid(value.audioToken) && audioText(value.text) && typeof value.durationSeconds === 'number' && Number.isFinite(value.durationSeconds) && value.durationSeconds > 0 && value.durationSeconds <= 120;
}

/** Every awaited boundary races cancellation, including dependencies that ignore it. */
export class AudioOperation {
  readonly controller = new AbortController();
  private deadline = Date.now() + AUDIO_OPERATION_MS;
  private readonly abort = () => this.controller.abort();
  private readonly parent: AbortSignal;
  constructor(parent: AbortSignal) { this.parent = parent; parent.addEventListener('abort', this.abort, { once: true }); if (parent.aborted) this.abort(); }
  restrict(deadline: number): void { this.deadline = Math.min(this.deadline, deadline); this.check(); }
  check(): void { if (this.controller.signal.aborted || Date.now() >= this.deadline) throw new AudioError('unknown'); }
  async wait<T>(promise: Promise<T>, timeout = AUDIO_OPERATION_MS): Promise<T> {
    // Attach the promise before checking so a late rejection never becomes unhandled.
    const pending = Promise.resolve(promise);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let rejectAbort: (() => void) | undefined;
    try {
      const result = await Promise.race([pending, new Promise<never>((_, reject) => {
        rejectAbort = () => reject(new AudioError('unknown'));
        this.controller.signal.addEventListener('abort', rejectAbort, { once: true });
        timer = setTimeout(() => { this.controller.abort(); rejectAbort!(); }, Math.max(0, Math.min(timeout, this.deadline - Date.now())));
        if (this.controller.signal.aborted || Date.now() >= this.deadline) rejectAbort();
      })]);
      this.check(); return result;
    } finally { if (timer !== undefined) clearTimeout(timer); if (rejectAbort) this.controller.signal.removeEventListener('abort', rejectAbort); }
  }
  close(): void { this.parent.removeEventListener('abort', this.abort); this.controller.abort(); }
}
export function discardAudioBody(body: ReadableStream<Uint8Array> | null): void { try { void body?.cancel().catch(() => {}); } catch { /* No transport details. */ } }
export async function readAudioBytes(body: ReadableStream<Uint8Array> | null, maximum: number, operation: AudioOperation): Promise<Uint8Array> {
  if (!body) throw new AudioError('invalid_audio');
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      operation.check(); const next = await operation.wait(reader.read(), AUDIO_READ_MS);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.length === 0) throw new AudioError('invalid_audio');
      length += next.value.length; if (length > maximum) throw new AudioError('limit'); chunks.push(next.value);
    }
    if (!length) throw new AudioError('invalid_audio');
    const bytes = new Uint8Array(length); let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; } return bytes;
  } finally { try { void reader.cancel().catch(() => {}); } catch { /* No transport details. */ } reader.releaseLock(); }
}
