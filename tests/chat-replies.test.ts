import { expect, it } from 'vitest';
import { renderChatReply, OUT_OF_SCOPE_REPLY } from '@/lib/server/chat-replies';
import { privateBusinessDraft } from '@/lib/server/businesses';
const business = privateBusinessDraft({ uid: 'owner' }, 1000);
it('renders the exact business-only reply independently of model prose', () => {
  expect(renderChatReply({ intent: 'out_of_scope', business, data: { modelText: 'A fabricated investigation' } }).reply).toBe('Puedo ayudarte con los servicios, horarios y citas de este negocio. ¿Qué necesitas reservar o consultar?');
  expect(OUT_OF_SCOPE_REPLY).toContain('servicios');
});
it('does not invent an address or a confirmed reservation', () => {
  expect(renderChatReply({ intent: 'location', business, data: {} }).reply).toMatch(/no ha publicado/i);
  expect(renderChatReply({ intent: 'booking', business, data: {} }).reply).not.toMatch(/confirmada/);
});
