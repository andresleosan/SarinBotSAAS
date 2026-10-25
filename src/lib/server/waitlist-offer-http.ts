import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WaitlistOfferModelError } from '@/lib/waitlist-offers';
import { apiError, HttpError } from './http';

export function assertWaitlistOfferRequest(request: Request, readOnly = false) {
  if (request.url.includes('?') || readOnly && request.body !== null) throw new HttpError(400, 'Consulta inválida.');
}

export function waitlistOfferHttpError(error: unknown) {
  if (error instanceof WaitlistOfferModelError) return apiError(new HttpError(503, 'No se pudo verificar la oferta de espera.', 'WAITLIST_OFFER_UNVERIFIABLE'));
  // Only known domain/auth/validation errors can select status or public text.
  return apiError(error instanceof HttpError || error instanceof z.ZodError ? error : new HttpError(503, 'No se pudo verificar la oferta de espera.', 'WAITLIST_OFFER_UNVERIFIABLE'));
}

export function waitlistOfferGetOnly() {
  return NextResponse.json({ error: 'Método no permitido.' }, { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'GET' } });
}

export function waitlistOfferPostOnly() {
  return NextResponse.json({ error: 'Método no permitido.' }, { status: 405, headers: { 'Cache-Control': 'no-store', Allow: 'POST' } });
}
