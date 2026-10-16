import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export class HttpError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

/** Checks actual streamed bytes even when Content-Length is absent. */
export async function readJson<T extends z.ZodType>(request: Request, schema: T, maxBytes = 256 * 1024): Promise<z.infer<T>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Se requiere contenido JSON.');
  if (Number(request.headers.get('content-length') ?? 0) > maxBytes) throw new HttpError(413, 'El contenido supera el tamaño permitido.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'El cuerpo está vacío.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new HttpError(413, 'El contenido supera el tamaño permitido.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const combined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  let body: unknown;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(combined)); }
  catch { throw new HttpError(400, 'JSON no válido.'); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, 'Datos no válidos. Revisa los campos enviados.');
  return parsed.data;
}

export function apiError(error: unknown) {
  // Never log request bodies, tokens, financial data or upstream error text.
  if (error instanceof HttpError) return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof Error && 'status' in error && error.status === 429) return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '5' } });
  if (error instanceof z.ZodError) return NextResponse.json({ error: 'Datos no válidos.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  if (error instanceof Error && error.name === 'AbortError') return NextResponse.json({ error: 'Solicitud cancelada.' }, { status: 499, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ error: 'Servicio temporalmente no disponible. Revisa la configuración o inténtalo de nuevo.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
}
