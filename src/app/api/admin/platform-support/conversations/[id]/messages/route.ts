import { supportMessageHandlers } from '@/lib/server/platform-support-http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, POST } = supportMessageHandlers(true);
