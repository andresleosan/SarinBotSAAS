import 'server-only';
import type { Database } from '@/lib/storage/types';
import { getSettings } from '@/lib/server/billing';
import { buildPublicCommercialOffer, type PublicCommercialOffer } from '@/lib/commercial-offer';

export async function readPublicCommercialOffer(db?: Database): Promise<PublicCommercialOffer> {
  return buildPublicCommercialOffer(await getSettings(db));
}
