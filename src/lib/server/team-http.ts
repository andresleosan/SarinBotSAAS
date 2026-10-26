import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { HttpError, readJson } from './http';

export function teamQuery(request: Request, allowed: readonly string[], read = true): URLSearchParams {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !allowed.includes(key) || query.getAll(key).length !== 1)
    || read && request.body !== null) throw new HttpError(400, 'Consulta de equipo inválida.');
  return query;
}
export async function readTeamCommand<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  teamQuery(request, [], false);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Se requiere contenido JSON.');
  return readJson(request, schema, 4096);
}
export function teamResponse(value: unknown) { return NextResponse.json(value, { headers: { 'Cache-Control': 'no-store' } }); }
