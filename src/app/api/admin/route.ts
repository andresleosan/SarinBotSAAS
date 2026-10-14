import { NextResponse } from 'next/server';
import { getAdminDb } from '@/lib/firebase/admin';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError, readJson } from '@/lib/server/http';
import { adminActionSchema, documentIdSchema } from '@/lib/server/schemas';
import { getSettings, readReceiptImage, readReceipts, reviewPayment, saveSettings } from '@/lib/server/billing';
import type { Business } from '@/types/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export async function GET(request: Request) {
  try {
    const user = await requireSuperadmin(request);
    const receiptId = new URL(request.url).searchParams.get('receiptId');
    if (receiptId) return NextResponse.json({ receiptDataUrl: await readReceiptImage(user, documentIdSchema.parse(receiptId)) }, { headers });
    const [snapshot, receipts, settings] = await Promise.all([getAdminDb().collection('businesses').orderBy('createdAt', 'desc').limit(500).get(), readReceipts(), getSettings()]);
    return NextResponse.json({ businesses: snapshot.docs.map((document) => document.data() as Business), receipts, settings }, { headers });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    await requireSuperadmin(request);
    const input = await readJson(request, adminActionSchema, 32 * 1024);
    if (input.action === 'settings') return NextResponse.json({ settings: await saveSettings(input.settings) }, { headers });
    return NextResponse.json(await reviewPayment(input.paymentId, input.action, input.rejectionReason), { headers });
  } catch (error) { return apiError(error); }
}
