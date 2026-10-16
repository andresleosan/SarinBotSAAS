import { describe, expect, it } from 'vitest';
import { buildPublicCommercialOffer, commercialPriceCOP, publicCommercialOfferSchema } from '@/lib/commercial-offer';
import { readPublicCommercialOffer } from '@/lib/server/commercial-offer';
import { getSettings } from '@/lib/server/billing';
import { memoryFirestore } from './memoryFirestore';

describe('current commercial offer', () => {
  it('reads saved tariffs without exposing private settings or writing data', async () => {
    const { db, rows } = memoryFirestore({ 'platformSettings/main': {
      monthlyPriceCOP: 65000, responsePackPriceCOP: 23000,
      bankAccounts: [{ id: 'private-bank', accountNumber: 'PRIVATE-ACCOUNT', holderDoc: 'PRIVATE-ID' }],
      tunnelStatus: { isOnline: true, lastPingAt: 1 },
    } });
    const before = JSON.stringify([...rows]);
    const offer = await readPublicCommercialOffer(db);
    expect(offer).toEqual({
      currency: 'COP',
      trial: { priceCOP: 5000, appointmentLimit: 10, includedResponses: 700, expiresByDays: false },
      plans: [
        { id: 'weekly', label: 'Semanal', periodDays: 7, includedResponses: 700, priceCOP: 20000 },
        { id: 'fortnightly', label: 'Quincenal', periodDays: 15, includedResponses: 1500, priceCOP: 35000 },
        { id: 'monthly', label: 'Mensual', periodDays: 30, includedResponses: 3000, priceCOP: 65000 },
      ],
      responsePack: { responses: 1000, priceCOP: 23000 },
    });
    expect(JSON.stringify(offer)).not.toMatch(/PRIVATE|bankAccounts|tunnelStatus|whatsapp/);
    expect(JSON.stringify([...rows])).toBe(before);
  });

  it('uses the same current tariff calculator for receipts and public plans', async () => {
    const settings = { ...await getSettings(memoryFirestore().db), weeklyPriceCOP: 21000, whatsappPriceCOP: 155000 };
    expect(buildPublicCommercialOffer(settings).plans[0].priceCOP).toBe(21000);
    expect(commercialPriceCOP(settings, 'subscription', 'weekly')).toBe(21000);
    expect(commercialPriceCOP(settings, 'subscription', 'whatsapp')).toBe(155000);
    expect(commercialPriceCOP(settings, 'paid_trial')).toBe(5000);
    expect(commercialPriceCOP(settings, 'response_pack')).toBe(20000);
  });

  it.each([0, -1, 1.5, Number.NaN, 100000001])('rejects corrupted saved pricing: %s', async value => {
    const settings = { ...await getSettings(memoryFirestore().db), monthlyPriceCOP: value };
    expect(() => buildPublicCommercialOffer(settings)).toThrow();
    expect(() => commercialPriceCOP(settings, 'subscription', 'monthly')).toThrow();
  });

  it('rejects duplicate plans, altered capacities and private properties from a public response', async () => {
    const offer = buildPublicCommercialOffer(await getSettings(memoryFirestore().db));
    expect(publicCommercialOfferSchema.safeParse({ ...offer, bankAccounts: [] }).success).toBe(false);
    expect(publicCommercialOfferSchema.safeParse({ ...offer, plans: [offer.plans[0], offer.plans[0], offer.plans[2]] }).success).toBe(false);
    expect(publicCommercialOfferSchema.safeParse({ ...offer, plans: offer.plans.map(plan => ({ ...plan, includedResponses: 999999 })) }).success).toBe(false);
  });
});
