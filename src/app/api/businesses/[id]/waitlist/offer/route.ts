import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { waitlistOfferDocumentIdSchema } from '@/lib/waitlist-offers';
import { readCurrentClientWaitlistOffer } from '@/lib/server/waitlist-offers';
import { assertWaitlistOfferRequest, waitlistOfferHttpError } from '@/lib/server/waitlist-offer-http';
export { waitlistOfferGetOnly as POST, waitlistOfferGetOnly as PUT, waitlistOfferGetOnly as PATCH, waitlistOfferGetOnly as DELETE, waitlistOfferGetOnly as HEAD, waitlistOfferGetOnly as OPTIONS } from '@/lib/server/waitlist-offer-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    assertWaitlistOfferRequest(request, true);
    const params = await context.params;
    const id = waitlistOfferDocumentIdSchema.parse(params.id);
    return NextResponse.json(await readCurrentClientWaitlistOffer(actor, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return waitlistOfferHttpError(error); }
}
