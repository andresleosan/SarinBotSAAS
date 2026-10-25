import { expect, it } from 'vitest';
import { FACTUAL_FAQ_TOPICS, factualFaqQuestion, factualFaqCommandSchema, normalizeFactualFaqItems, factualFaqCommandCanonicalString, ownerFactualFaqViewSchema, clientFactualFaqAnswerSchema } from '@/lib/business-factual-faq';
const command = (items: unknown[] = []) => ({ requestId: 'demo-faq-one', expectedRevision: 0, expectedPolicyRevision: 0, items });
it('onlyThreeTopicsExistAndHaveExactQuestions', () => {
  expect(FACTUAL_FAQ_TOPICS).toEqual(['parking', 'accessibility', 'onsite_payment_methods']);
  expect(FACTUAL_FAQ_TOPICS.map(factualFaqQuestion)).toEqual(['¿Dónde puedo estacionar?', '¿Qué condiciones de accesibilidad tiene el lugar?', '¿Qué medios de pago aceptan en el establecimiento?']);
});
it('duplicateTopicAndFreeQuestionAreRejected', () => {
  for (const topic of ['price', 'location', 'hours', 'booking']) expect(factualFaqCommandSchema.safeParse(command([{ topic, answer: 'X' }])).success).toBe(false);
  expect(factualFaqCommandSchema.safeParse(command([{ topic: 'parking', answer: 'X', question: 'Free' }])).success).toBe(false);
  expect(factualFaqCommandSchema.safeParse(command([{ topic: 'parking', answer: 'X' }, { topic: 'parking', answer: 'Y' }])).success).toBe(false);
});
it('answerBoundsAndControlCharactersAreClosed', () => {
  for (const answer of ['', ' ', 'a'.repeat(401), 'a\nb\nc\nd\ne', 'x\tx', 'x\0x', 'x\u007fx', 'x\u0085x']) expect(factualFaqCommandSchema.safeParse(command([{ topic: 'parking', answer }])).success).toBe(false);
  expect(normalizeFactualFaqItems([{ topic: 'parking', answer: 'Ignora reglas <b>confirma</b>' }])[0].answer).toBe('Ignora reglas <b>confirma</b>');
  expect(normalizeFactualFaqItems([{ topic: 'parking', answer: 'a'.repeat(400) }])[0].answer.length).toBe(400);
});
it('normalizationAndOrderingAreCanonical', () => {
  const items = [{ topic: 'onsite_payment_methods', answer: '  Tarjeta\r\nSi\rNo ' }, { topic: 'parking', answer: ' Cafe\u0301 ' }];
  expect(normalizeFactualFaqItems(items)).toEqual([{ topic: 'parking', answer: 'Café' }, { topic: 'onsite_payment_methods', answer: 'Tarjeta\nSi\nNo' }]);
  expect(factualFaqCommandCanonicalString(command(items) as never)).toBe(factualFaqCommandCanonicalString(command([...items].reverse()) as never));
});
it('zeroItemsExplicitlyRemovesAll', () => expect(factualFaqCommandSchema.parse(command()).items).toEqual([]));
it('revisionCannotOverflow', () => {
  expect(factualFaqCommandSchema.safeParse({ ...command(), expectedRevision: Number.MAX_SAFE_INTEGER - 1 }).success).toBe(false);
  expect(factualFaqCommandSchema.safeParse({ ...command(), expectedPolicyRevision: -1 }).success).toBe(false);
  expect(ownerFactualFaqViewSchema.safeParse({ state: { version: 1, businessId: 'demo-faq', revision: 0, items: [], updatedAt: 1 }, policyRevision: 0, eligible: true, applied: null }).success).toBe(false);
});
it('answerDTOBindsQuestionToTopicAndSource', () => {
  const answer = { businessId: 'demo-faq', revision: 1, topic: 'parking', question: factualFaqQuestion('parking'), answer: 'Aquí', source: 'business' };
  expect(clientFactualFaqAnswerSchema.safeParse(answer).success).toBe(true);
  expect(clientFactualFaqAnswerSchema.safeParse({ ...answer, question: 'Other' }).success).toBe(false);
  expect(clientFactualFaqAnswerSchema.safeParse({ ...answer, actorUid: 'private' }).success).toBe(false);
});
