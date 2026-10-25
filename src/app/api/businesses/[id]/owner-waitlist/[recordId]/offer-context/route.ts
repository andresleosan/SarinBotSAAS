import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { waitlistOfferDocumentIdSchema } from '@/lib/waitlist-offers';
import { readOwnerWaitlistOfferContext } from '@/lib/server/waitlist-offers';
import { assertWaitlistOfferRequest, waitlistOfferHttpError } from '@/lib/server/waitlist-offer-http';
export { waitlistOfferGetOnly as POST, waitlistOfferGetOnly as PUT, waitlistOfferGetOnly as PATCH, waitlistOfferGetOnly as DELETE, waitlistOfferGetOnly as HEAD, waitlistOfferGetOnly as OPTIONS } from '@/lib/server/waitlist-offer-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    const actor = await requireUser(request);
    assertWaitlistOfferRequest(request, true);
    const params = await context.params;
    const id = waitlistOfferDocumentIdSchema.parse(params.id), recordId = waitlistOfferDocumentIdSchema.parse(params.recordId);
    return NextResponse.json(await readOwnerWaitlistOfferContext(actor, id, recordId), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return waitlistOfferHttpError(error); }
}
