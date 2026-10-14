import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { documentIdSchema, receiptSchema } from '@/lib/server/schemas';
import { getOwnedBusiness } from '@/lib/server/businesses';
import { getSettings, readReceiptImage, readReceipts, submitReceipt } from '@/lib/server/billing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const receiptId = new URL(request.url).searchParams.get('receiptId');
    if (receiptId) return NextResponse.json({ receiptDataUrl: await readReceiptImage(user, documentIdSchema.parse(receiptId)) }, { headers });
    const [settings, receipts, business] = await Promise.all([getSettings(), readReceipts(user.uid), getOwnedBusiness(user.uid)]);
    return NextResponse.json({ settings, receipts, business }, { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = await readJson(request, receiptSchema, 230 * 1024);
    return NextResponse.json(await submitReceipt(user, input), { status: 201, headers });
  } catch (error) { return apiError(error); }
}
