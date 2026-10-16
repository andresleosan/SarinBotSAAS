import { apiError } from '@/lib/server/http';
import { readPublicBusinessLogo } from '@/lib/server/business-logos';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(_request: Request, context: { params: Promise<{ slug: string; sha256: string }> }) {
  try {
    const { slug, sha256 } = await context.params;
    const bytes = await readPublicBusinessLogo(slug, sha256);
    return new Response(new Uint8Array(bytes).buffer, { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' } });
  } catch (error) { return apiError(error); }
}
