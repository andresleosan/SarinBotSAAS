import { z } from 'zod';

export const FACTUAL_FAQ_TOPICS = ['parking', 'accessibility', 'onsite_payment_methods'] as const;
export type FactualFaqTopic = typeof FACTUAL_FAQ_TOPICS[number];
const questions: Record<FactualFaqTopic, string> = {
  parking: '¿Dónde puedo estacionar?',
  accessibility: '¿Qué condiciones de accesibilidad tiene el lugar?',
  onsite_payment_methods: '¿Qué medios de pago aceptan en el establecimiento?',
};
export const factualFaqQuestion = (topic: FactualFaqTopic): string => questions[topic];
export const factualFaqTopicSchema = z.enum(FACTUAL_FAQ_TOPICS);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).refine(value => !['__proto__', 'prototype', 'constructor'].includes(value));
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const expectation = count.max(Number.MAX_SAFE_INTEGER - 2);
const answer = z.string().refine(value => !/[\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value), 'Usa texto sin controles.').transform(value => value.normalize('NFC').replace(/\r\n?/g, '\n').trim()).pipe(z.string().min(1).max(400).refine(value => value.split('\n').length <= 4, 'Usa hasta tres saltos de línea.'));
export const factualFaqItemSchema = z.object({ topic: factualFaqTopicSchema, answer }).strict();
const items = z.array(factualFaqItemSchema).max(3).refine(value => new Set(value.map(item => item.topic)).size === value.length, 'No repitas preguntas.').transform(value => [...value].sort((a, b) => FACTUAL_FAQ_TOPICS.indexOf(a.topic) - FACTUAL_FAQ_TOPICS.indexOf(b.topic)));
export const factualFaqCommandSchema = z.object({ requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}$/), expectedRevision: expectation, expectedPolicyRevision: expectation, items }).strict();
export const factualFaqStateSchema = z.object({ version: z.literal(1), businessId: id, revision: count, items, updatedAt: z.number().int().nonnegative().safe().nullable() }).strict().refine(value => value.revision === 0 ? value.updatedAt === null && value.items.length === 0 : value.updatedAt !== null, 'Revisión inválida.');
export const factualFaqAppliedSchema = z.object({ requestId: factualFaqCommandSchema.shape.requestId, commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/), revision: count.min(1), savedAt: z.number().int().nonnegative().safe() }).strict();
export const ownerFactualFaqViewSchema = z.object({ state: factualFaqStateSchema, policyRevision: count, eligible: z.boolean(), applied: factualFaqAppliedSchema.nullable() }).strict().refine(value => !value.applied || value.applied.revision <= value.state.revision);
const topicLabel = z.object({ topic: factualFaqTopicSchema, question: z.string() }).strict().refine(value => value.question === factualFaqQuestion(value.topic));
export const clientFactualFaqTopicsSchema = z.object({ businessId: id, revision: count, topics: z.array(topicLabel).max(3).refine(value => new Set(value.map(item => item.topic)).size === value.length) }).strict();
export const clientFactualFaqAnswerSchema = z.object({ businessId: id, revision: count.min(1), topic: factualFaqTopicSchema, question: z.string(), answer, source: z.literal('business') }).strict().refine(value => value.question === factualFaqQuestion(value.topic));
export type FactualFaqItem = z.infer<typeof factualFaqItemSchema>;
export type FactualFaqCommand = z.infer<typeof factualFaqCommandSchema>;
export type FactualFaqState = z.infer<typeof factualFaqStateSchema>;
export type FactualFaqApplied = z.infer<typeof factualFaqAppliedSchema>;
export type OwnerFactualFaqView = z.infer<typeof ownerFactualFaqViewSchema>;
export type ClientFactualFaqTopics = z.infer<typeof clientFactualFaqTopicsSchema>;
export type ClientFactualFaqAnswer = z.infer<typeof clientFactualFaqAnswerSchema>;
export const normalizeFactualFaqItems = (value: unknown): FactualFaqItem[] => items.parse(value);
export function factualFaqCommandCanonicalString(command: FactualFaqCommand): string {
  const value = factualFaqCommandSchema.parse(command);
  return JSON.stringify({ requestId: value.requestId, expectedRevision: value.expectedRevision, expectedPolicyRevision: value.expectedPolicyRevision, items: value.items.map(item => ({ topic: item.topic, answer: item.answer })) });
}
