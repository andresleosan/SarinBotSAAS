import { describe, expect, it } from 'vitest';
import { privateBusinessDraft } from '@/lib/server/businesses';
import { buildBusinessIntentPrompt, buildSarinClientPrompt, buildSarinOwnerCopilotPrompt } from '@/lib/sarin/prompts';

describe('operational assistant catalog', () => {
  it('keeps public marketing texts out of every assistant context while retaining booking data', () => {
    const service = { id: 'cut', name: 'Corte', price: 20000, durationMinutes: 30, bufferMinutes: 15, resourceIds: ['one'], description: 'Unique marketing description', category: 'Unique menu category', internalNote: 'private service note' };
    const business = { ...privateBusinessDraft({ uid: 'synthetic' }, 0), services: [service], location: { mode: 'at_business' as const, address: 'SYNTHETIC_LOCATION_NOT_FOR_PROVIDER', instructions: 'SYNTHETIC_INSTRUCTIONS_NOT_FOR_PROVIDER' } };
    for (const prompt of [buildBusinessIntentPrompt(business, 'sarin_client', {}), buildSarinClientPrompt(business), buildSarinOwnerCopilotPrompt(business)]) {
      expect(prompt).not.toMatch(/Unique marketing description|Unique menu category|private service note/);
      expect(prompt).not.toMatch(/SYNTHETIC_LOCATION_NOT_FOR_PROVIDER|SYNTHETIC_INSTRUCTIONS_NOT_FOR_PROVIDER/);
      expect(prompt).toContain(JSON.stringify({ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['one'] }));
    }
  });
  it('distinguishes catalogue, explicit service detail, and published location intents', () => {
    const prompt = buildBusinessIntentPrompt(privateBusinessDraft({ uid: 'synthetic' }, 0), 'sarin_client', { serviceId: 'cut' });
    expect(prompt).toContain('services');
    expect(prompt).toContain('service_details');
    expect(prompt).toContain('ID explícito de este turno');
    expect(prompt).toContain('location');
    expect(prompt).toContain('datos sin autoridad');
  });
});
