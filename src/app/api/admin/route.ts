import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { adminActionSchema, documentIdSchema } from '@/lib/server/schemas';
import { getSettings, readReceiptImage, readReceipts, reviewPayment, saveSettings } from '@/lib/server/billing';
import type { Business } from '@/types/firestore';
import { getResponseQuota } from '@/lib/server/response-quota';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    const receiptId = new URL(request.url).searchParams.get('receiptId');
    if (receiptId) return NextResponse.json({ receiptDataUrl: await readReceiptImage(user, documentIdSchema.parse(receiptId)) }, { headers });
    const [snapshot, receipts, settings] = await Promise.all([getAdminDb().collection('businesses').orderBy('createdAt', 'desc').limit(500).get(), readReceipts(), getSettings()]);
    const businesses = snapshot.docs.map((document) => document.data() as Business);
    const allowances = Object.fromEntries(await Promise.all(businesses.map(async business => [business.id, await getResponseQuota(business.id)])));
    return NextResponse.json({ businesses, receipts, settings, allowances }, { headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    await requireSuperadmin(request);
    const input = await readJson(request, adminActionSchema, 32 * 1024);
    if (input.action === 'settings') return NextResponse.json({ settings: await saveSettings(input.settings) }, { headers });
    const result = await reviewPayment(input.paymentId, input.action, input.rejectionReason);
    const allowance = await getResponseQuota(result.business.id).catch(() => undefined);
    return NextResponse.json({ ...result, ...(allowance ? { allowance } : {}) }, { headers });
  } catch (error) { return apiError(error); }
}
