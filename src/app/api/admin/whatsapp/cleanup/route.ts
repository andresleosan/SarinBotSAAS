import { NextResponse } from 'next/server';
import { requireSuperadmin } from '@/lib/server/auth';
import { apiError } from '@/lib/server/http';
import { cleanupWhatsAppRetention } from '@/lib/server/whatsapp-store';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) {
  try {
    await requireSuperadmin(request);
    const result = await cleanupWhatsAppRetention();
    return NextResponse.json({ cleanedBatch: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
