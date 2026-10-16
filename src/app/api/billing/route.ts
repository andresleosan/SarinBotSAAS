import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { documentIdSchema, receiptSchema } from '@/lib/server/schemas';
import { getOwnedBusiness } from '@/lib/server/businesses';
import { getSettings, readReceiptImage, readReceipts, submitReceipt } from '@/lib/server/billing';
import { getResponseQuota } from '@/lib/server/response-quota';
import { getWhatsAppBusinessStatus } from '@/lib/server/whatsapp-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const receiptId = new URL(request.url).searchParams.get('receiptId');
    if (receiptId) return NextResponse.json({ receiptDataUrl: await readReceiptImage(user, documentIdSchema.parse(receiptId)) }, { headers });
    const [settings, receipts, business] = await Promise.all([getSettings(), readReceipts(user.uid), getOwnedBusiness(user.uid)]);
    const [allowance, whatsapp] = business ? await Promise.all([getResponseQuota(business.id), getWhatsAppBusinessStatus(business.id)]) : [null, { ready: false }];
    return NextResponse.json({ settings, receipts, business, allowance, whatsappAvailable: whatsapp.ready }, { headers });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const input = await readJson(request, receiptSchema, 230 * 1024);
    const result = await submitReceipt(user, input);
    // A summary read cannot turn an already accepted receipt into a failed upload.
    const allowance = await getResponseQuota(result.business.id).catch(() => undefined);
    return NextResponse.json({ ...result, ...(allowance ? { allowance } : {}) }, { status: 201, headers });
  } catch (error) { return apiError(error); }
}
