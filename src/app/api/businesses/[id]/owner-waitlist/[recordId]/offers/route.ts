import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { waitlistOfferDocumentIdSchema, ownerWaitlistOfferCommandSchema } from '@/lib/waitlist-offers';
import { createOwnerWaitlistOffer } from '@/lib/server/waitlist-offers';
import { readJson } from '@/lib/server/http';
import { assertWaitlistOfferRequest, waitlistOfferHttpError } from '@/lib/server/waitlist-offer-http';
export { waitlistOfferPostOnly as GET, waitlistOfferPostOnly as PUT, waitlistOfferPostOnly as PATCH, waitlistOfferPostOnly as DELETE, waitlistOfferPostOnly as HEAD, waitlistOfferPostOnly as OPTIONS } from '@/lib/server/waitlist-offer-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const actor = await requireUser(request);
    assertWaitlistOfferRequest(request);
    const params = await context.params;
    const id = waitlistOfferDocumentIdSchema.parse(params.id), recordId = waitlistOfferDocumentIdSchema.parse(params.recordId);
    const input = await readJson(request, ownerWaitlistOfferCommandSchema, 2048);
    return NextResponse.json(await createOwnerWaitlistOffer(actor, id, recordId, input), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return waitlistOfferHttpError(error); }
}
