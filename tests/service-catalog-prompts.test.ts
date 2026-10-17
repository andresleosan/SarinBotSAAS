import { describe, expect, it } from 'vitest';
import { privateBusinessDraft } from '@/lib/server/businesses';
import { buildBusinessIntentPrompt, buildSarinClientPrompt, buildSarinOwnerCopilotPrompt } from '@/lib/sarin/prompts';

describe('operational assistant catalog', () => {
  it('keeps public marketing texts out of every assistant context while retaining booking data', () => {
    const service = { id: 'cut', name: 'Corte', price: 20000, durationMinutes: 30, bufferMinutes: 15, resourceIds: ['one'], description: 'Unique marketing description', category: 'Unique menu category', internalNote: 'private service note' };
    const business = { ...privateBusinessDraft({ uid: 'synthetic' }, 0), services: [service] };
    for (const prompt of [buildBusinessIntentPrompt(business, 'sarin_client', {}), buildSarinClientPrompt(business), buildSarinOwnerCopilotPrompt(business)]) {
      expect(prompt).not.toMatch(/Unique marketing description|Unique menu category|private service note/);
      expect(prompt).toContain(JSON.stringify({ id: 'cut', name: 'Corte', durationMinutes: 30, bufferMinutes: 15, price: 20000, resourceIds: ['one'] }));
    }
  });
});
