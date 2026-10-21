import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBoundedRequestBody as read } from '@/lib/server/read-bounded-body';
import { HttpError } from '@/lib/server/http';

const options = { maxBytes: 4, timeoutMs: 100 };
const request = (body: ReadableStream<Uint8Array> | null, signal = new AbortController().signal) => ({ body, signal }) as Request;
function stream(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
}
async function failure(promise: Promise<unknown>, status: number, message: string) {
  await expect(promise).rejects.toBeInstanceOf(HttpError);
  await expect(promise).rejects.toMatchObject({ status, message });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('bounded byte reader', () => {
  it('returns a Buffer, counts bytes, skips empty chunks and releases its lock', async () => {
    vi.useFakeTimers();
    const body = stream([new Uint8Array(), new Uint8Array([0xc3]), new Uint8Array([0xa9, 0, 255])]);
    const bytes = await read(request(body), options);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect([...bytes]).toEqual([195, 169, 0, 255]);
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('accepts empty streams and caller limits above one MiB', async () => {
    expect(await read(request(stream([])), options)).toEqual(Buffer.alloc(0));
    const bytes = Buffer.alloc(1048577, 1);
    expect((await read(request(stream([bytes])), { ...options, maxBytes: bytes.length })).length).toBe(1048577);
  });
  it.each([{ maxBytes: 0 }, { maxBytes: -1 }, { maxBytes: 1.5 }, { maxBytes: Number.MAX_SAFE_INTEGER + 1 }, { timeoutMs: 0 }, { timeoutMs: NaN }, { timeoutMs: 1.5 }, { timeoutMs: 0x80000000 }])('rejects invalid limits before requesting a body: %j', async (invalid) => {
    await failure(read({ get body(): never { throw new Error('body visited'); } } as unknown as Request, { ...options, ...invalid }), 503, 'El límite de lectura no es válido.');
  });
  it('accepts the maximum timeout and positive safe integer byte bound', async () => {
    expect(await read(request(stream([])), { maxBytes: Number.MAX_SAFE_INTEGER, timeoutMs: 0x7fffffff })).toEqual(Buffer.alloc(0));
  });
  it('maps unavailable, locked and throwing readers to 400', async () => {
    const locked = stream([]); const reader = locked.getReader();
    for (const value of [request(null), request(locked), { body: {} }, { get body() { throw new Error('synthetic'); } }]) await failure(read(value as Request, options), 400, 'El cuerpo no está disponible.');
    reader.releaseLock();
  });
  it('rejects excess bytes and releases even if cancellation never settles', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(Buffer.alloc(5)); }, cancel() { cancelled = true; return new Promise(() => {}); } });
    await failure(read(request(body), options), 413, 'El cuerpo supera el tamaño permitido.');
    expect(cancelled).toBe(true);
    expect(body.locked).toBe(false);
  });
  it('maps a stream failure without exposing the producer error', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('synthetic private producer detail')); } });
    await failure(read(request(body), options), 400, 'No se pudo leer el cuerpo.');
    expect(body.locked).toBe(false);
  });
  it('rejects pre-abort and in-flight abort with 499', async () => {
    const before = new AbortController(); before.abort();
    await failure(read(request(stream([]), before.signal), options), 499, 'Solicitud cancelada.');
    const during = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return Promise.reject(new Error('cancel failure')); } });
    const result = read(request(body, during.signal), options);
    const assertion = failure(result, 499, 'Solicitud cancelada.');
    during.abort();
    await assertion;
    expect(body.locked).toBe(false);
  });
  it('bounds an unresponsive producer and removes timer/abort listener', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, 'addEventListener');
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { return new Promise(() => {}); } });
    const result = read(request(body, controller.signal), options);
    const assertion = failure(result, 408, 'Se agotó el tiempo de lectura del cuerpo.');
    void assertion.catch(() => {});
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(body.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0][1]);
  });
  it('checks the total deadline after a read even when its timer has not fired', async () => {
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(0).mockReturnValueOnce(10).mockReturnValue(100);
    await failure(read(request(stream([new Uint8Array([1])])), options), 408, 'Se agotó el tiempo de lectura del cuerpo.');
  });
  it('checks total deadline before reads and abort before accepting done', async () => {
    vi.spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(100);
    await failure(read(request(stream([])), options), 408, 'Se agotó el tiempo de lectura del cuerpo.');
    vi.restoreAllMocks();
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>({ pull(streamController) { controller.abort(); streamController.close(); } });
    await failure(read(request(body, controller.signal), options), 499, 'Solicitud cancelada.');
  });
});
