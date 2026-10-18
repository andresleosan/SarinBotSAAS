import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { documentIdSchema } from '@/lib/server/schemas';
import { confirmBookingProposalDetailed } from '@/lib/server/booking-proposals';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const schema = z.object({ confirm: z.literal(true), clientPhone: z.unknown(), intakeAnswers: z.unknown(), beneficiary: z.unknown().optional() }).strict();
export async function POST(request: Request, context: { params: Promise<{ id: string; proposalId: string }> }) {
  try {
    const user = await requireUser(request), params = await context.params;
    const id = documentIdSchema.parse(params.id), proposalId = documentIdSchema.parse(params.proposalId), body = await readJson(request, schema, 16 * 1024);
    // The domain validates contact only for a fresh confirmation. A replay reads
    // the saved appointment before trusting any new contact from the browser.
    const result = await confirmBookingProposalDetailed(user, id, proposalId, body as { clientPhone: unknown; intakeAnswers: unknown; beneficiary?: unknown });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
