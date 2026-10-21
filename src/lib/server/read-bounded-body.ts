import 'server-only';
import { HttpError } from '@/lib/server/http';

export interface BoundedBodyOptions { maxBytes: number; timeoutMs: number }

/** Read original bytes under a total deadline, including stalled producers/cancellation. */
export async function readBoundedRequestBody(request: Request, options: BoundedBodyOptions): Promise<Buffer> {
  if (!Number.isSafeInteger(options.maxBytes) || options.maxBytes <= 0 || !Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > 0x7fffffff) {
    throw new HttpError(503, 'El límite de lectura no es válido.');
  }
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    if (!request.body) throw new Error();
    reader = request.body.getReader();
  } catch { throw new HttpError(400, 'El cuerpo no está disponible.'); }
  const deadline = performance.now() + options.timeoutMs;
  const timedOut = () => new HttpError(408, 'Se agotó el tiempo de lectura del cuerpo.');
  const aborted = () => new HttpError(499, 'Solicitud cancelada.');
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(timedOut()), options.timeoutMs);
    onAbort = () => reject(aborted());
    request.signal.addEventListener('abort', onAbort, { once: true });
  });
  const chunks: Buffer[] = [];
  let length = 0;
  async function consume(): Promise<Buffer> {
    for (;;) {
      if (request.signal.aborted) throw aborted();
      if (performance.now() >= deadline) throw timedOut();
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); }
      catch { throw new HttpError(400, 'No se pudo leer el cuerpo.'); }
      if (request.signal.aborted) throw aborted();
      if (performance.now() >= deadline) throw timedOut();
      if (chunk.done) { finished = true; break; }
      length += chunk.value.byteLength;
      if (length > options.maxBytes) throw new HttpError(413, 'El cuerpo supera el tamaño permitido.');
      if (chunk.value.byteLength) chunks.push(Buffer.from(chunk.value));
    }
    return Buffer.concat(chunks, length);
  }
  try { return await Promise.race([consume(), interrupted]); }
  finally {
    clearTimeout(timer);
    if (onAbort) request.signal.removeEventListener('abort', onAbort);
    if (!finished) {
      try { reader.cancel().catch(() => {}); } catch {}
    }
    try { reader.releaseLock(); } catch {}
  }
}
