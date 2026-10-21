import 'server-only';
import { z } from 'zod';
import type { Database, DocumentData, Transaction } from '@/lib/storage/types';
import { getAdminDb } from '@/lib/firebase/admin';
import type { AdminWhatsAppConversation, AdminWhatsAppConversations, WhatsAppConversationMode } from '@/types/whatsapp';
import { documentIdSchema } from './schemas';
import { metaIdSchema, readWhatsAppConfig } from './whatsapp-config';
import { decryptWhatsApp } from './whatsapp-security';
import { HttpError } from './http';

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const mode = z.enum(['bot', 'human', 'review']);
export const whatsAppConversationControlSchema = z.object({
  conversationId: z.string().regex(/^[a-f0-9]{64}$/), mode,
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
}).strict();
const metadataSchema = z.object({
  businessId: documentIdSchema, phoneNumberId: metaIdSchema, wabaId: metaIdSchema,
  mode, revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  updatedAt: time, lastInboundAt: time.nullable(), lastHumanAt: time.nullable(),
  controlChangedAt: time, bodyExpiresAt: time, expiresAt: time,
}).passthrough();
export const conversationContactSchema = z.object({
  phone: z.string().regex(/^[1-9]\d{7,14}$/), name: z.string().max(256).nullable(),
  lastMessage: z.string().max(4096).nullable(),
}).strict();
export type ConversationMetadata = z.infer<typeof metadataSchema>;
export type ConversationScope = { businessId: string; phoneNumberId: string; wabaId: string; conversationId: string; conversationRevision?: number };
type ActiveOperations = WeakMap<Database, Map<string, Set<{ revision: number; controller: AbortController }>>>;
// Share cancellation across Next route/instrumentation bundles in the one supported process.
const runtime = globalThis as typeof globalThis & { __sarinWhatsAppOperations?: ActiveOperations };
const operations = runtime.__sarinWhatsAppOperations ??= new WeakMap();
export function registerWhatsAppOperation(scope: ConversationScope, db: Database, timeoutMs: number) {
  let byConversation = operations.get(db);
  if (!byConversation) { byConversation = new Map(); operations.set(db, byConversation); }
  let active = byConversation.get(scope.conversationId);
  if (!active) { active = new Set(); byConversation.set(scope.conversationId, active); }
  const operation = { revision: scope.conversationRevision ?? 0, controller: new AbortController() };
  active.add(operation);
  return { signal: AbortSignal.any([operation.controller.signal, AbortSignal.timeout(timeoutMs)]),
    dispose: () => { active.delete(operation); if (!active.size) byConversation.delete(scope.conversationId); } };
}
export function cancelSupersededWhatsAppOperations(conversationId: string, revision: number, db: Database): void {
  for (const operation of operations.get(db)?.get(conversationId) ?? []) {
    if (operation.revision !== revision) operation.controller.abort();
  }
}

// The only legacy shape is the pre-handoff encrypted history, without control fields.
export function parseConversationMetadata(value: DocumentData | undefined): ConversationMetadata | null {
  if (!value || ['businessId', 'phoneNumberId', 'wabaId', 'mode', 'revision'].every(key => value[key] === undefined)) return null;
  const parsed = metadataSchema.safeParse(value);
  if (!parsed.success) throw new HttpError(503, 'El estado de atención de WhatsApp no es válido.');
  return parsed.data;
}
export function conversationPermitsReply(value: DocumentData | undefined, scope: ConversationScope): boolean {
  const metadata = parseConversationMetadata(value);
  if (!metadata) return scope.conversationRevision === undefined;
  return metadata.businessId === scope.businessId && metadata.phoneNumberId === scope.phoneNumberId && metadata.wabaId === scope.wabaId
    && metadata.mode === 'bot' && metadata.revision === (scope.conversationRevision ?? 0);
}
export async function conversationAllowsReply(scope: ConversationScope, db: Database): Promise<boolean> {
  const document = await db.collection('whatsappConversations').doc(scope.conversationId).get();
  return conversationPermitsReply(document.data(), scope);
}
export function appendConversationControl(value: DocumentData, nextMode: WhatsAppConversationMode, actorUid: string | null, source: 'admin' | 'business_app' | 'system', now: number) {
  const events = Array.isArray(value.controlEvents) ? value.controlEvents : [];
  // A generated but unsent reply may be in the old history. A new control epoch
  // starts a fresh bot context instead of presenting that reply as delivered.
  return { mode: nextMode, revision: Number(value.revision ?? 0) + 1, controlChangedAt: now, content: null,
    updatedAt: Math.max(Number(value.updatedAt ?? 0), now),
    controlEvents: [...events.slice(-49), { mode: nextMode, actorUid, source, at: now }] };
}
export async function markConversationForReview(scope: ConversationScope, db: Database, transaction: Transaction): Promise<void> {
  const reference = db.collection('whatsappConversations').doc(scope.conversationId);
  const snapshot = await transaction.get(reference);
  if (!parseConversationMetadata(snapshot.data()) || !conversationPermitsReply(snapshot.data(), scope)) return;
  transaction.set(reference, { ...snapshot.data(), ...appendConversationControl(snapshot.data()!, 'review', null, 'system', Date.now()) });
}
export function publicWhatsAppConversation(id: string, value: DocumentData, now = Date.now()): AdminWhatsAppConversation {
  const metadata = parseConversationMetadata(value);
  if (!metadata) throw new HttpError(409, 'La conversación todavía no tiene información de atención.');
  const config = readWhatsAppConfig();
  const available = Boolean(config.enabled && config.configured && value.contactContent && metadata.bodyExpiresAt > now);
  const contact = available ? conversationContactSchema.parse(decryptWhatsApp(value.contactContent, `whatsappConversations/${id}/contact`)) : null;
  return { id, businessId: metadata.businessId, phoneNumberId: metadata.phoneNumberId, mode: metadata.mode, revision: metadata.revision,
    updatedAt: new Date(metadata.updatedAt).toISOString(), lastInboundAt: metadata.lastInboundAt === null ? null : new Date(metadata.lastInboundAt).toISOString(),
    lastHumanAt: metadata.lastHumanAt === null ? null : new Date(metadata.lastHumanAt).toISOString(),
    customerName: contact?.name ?? null, customerPhone: contact ? `+${contact.phone}` : null, lastMessage: contact?.lastMessage ?? null, contentAvailable: available };
}
export async function getWhatsAppConversations(db: Database = getAdminDb(), now = Date.now()): Promise<AdminWhatsAppConversations> {
  const snapshot = await db.collection('whatsappConversations').orderBy('updatedAt', 'desc').limit(101).get();
  const documents = snapshot.docs.slice(0, 100);
  const current = documents.filter(document => parseConversationMetadata(document.data()) !== null && Number(document.data().expiresAt) > now);
  return { conversations: current.map(document => publicWhatsAppConversation(document.id, document.data(), now)), truncated: snapshot.size > 100 || current.length < documents.length };
}
export async function setWhatsAppConversationMode(input: z.infer<typeof whatsAppConversationControlSchema>, actorUid: string, db: Database = getAdminDb()): Promise<AdminWhatsAppConversation> {
  const value = whatsAppConversationControlSchema.parse(input);
  const reference = db.collection('whatsappConversations').doc(value.conversationId);
  const updated = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new HttpError(404, 'La conversación no existe.');
    const previous = snapshot.data()!;
    const metadata = parseConversationMetadata(previous);
    if (!metadata || metadata.expiresAt <= Date.now()) throw new HttpError(409, 'Actualiza la bandeja antes de cambiar la atención.');
    if (metadata.revision !== value.expectedRevision) throw new HttpError(409, 'La atención cambió. Actualiza la bandeja e inténtalo de nuevo.');
    if (metadata.mode === value.mode) return previous;
    const next = { ...previous, ...appendConversationControl(previous, value.mode, actorUid, 'admin', Date.now()) };
    transaction.set(reference, next);
    return next;
  });
  cancelSupersededWhatsAppOperations(value.conversationId, Number(updated.revision), db);
  return publicWhatsAppConversation(value.conversationId, updated);
}
