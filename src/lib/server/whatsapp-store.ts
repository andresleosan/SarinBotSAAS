import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminDb } from '@/lib/firebase/admin';
import type { ChatResponse } from '@/types/chat';
import type { WhatsAppUsage, WhatsAppUsageCounters } from '@/types/whatsapp';
import type { ResponseQuotaReservation } from './response-quota';
import { bindingReady, metaIdSchema, parseWhatsAppBinding, readWhatsAppConfig } from './whatsapp-config';
import { decryptWhatsApp, encryptWhatsApp, type WhatsAppCiphertext } from './whatsapp-security';
import { HttpError } from './http';

export const WHATSAPP_DAY = 86_400_000;
export const WHATSAPP_TERMINAL = Number.MAX_SAFE_INTEGER;
export const whatsappHash = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const timestamp = z.string().regex(/^\d{1,13}$/).transform(value => Number(value) * 1000).refine(Number.isSafeInteger);
const wamid = z.string().min(1).max(512);
const pricingSchema = z.object({ type: z.enum(['regular', 'free_customer_service', 'free_entry_point']), category: z.string().max(64) });
const valueSchema = z.object({ messaging_product: z.literal('whatsapp'), metadata: z.object({ phone_number_id: metaIdSchema }),
  contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string().max(256) }).optional() })).max(100).optional(),
  messages: z.array(z.object({ id: wamid, from: z.string().regex(/^[1-9]\d{7,14}$/), timestamp, type: z.string().max(64), text: z.object({ body: z.string().min(1).max(4096) }).optional() })).max(100).optional(),
  statuses: z.array(z.object({ id: wamid, status: z.enum(['sent', 'delivered', 'read', 'failed', 'played']), timestamp, biz_opaque_callback_data: z.string().max(512).optional(), pricing: z.unknown().optional(), errors: z.array(z.object({ code: z.number().int() })).max(10).optional() })).max(100).optional(),
});
const payloadSchema = z.object({ object: z.literal('whatsapp_business_account'), entry: z.array(z.object({ id: metaIdSchema, changes: z.array(z.object({ field: z.string(), value: z.unknown() })).max(100) })).max(100) });

export interface WhatsAppInbox {
  businessId: string; phoneNumberId: string; wabaId: string; conversationId: string;
  state: 'pending' | 'processing' | 'completed' | 'review' | 'expired';
  receivedAt: number; windowEndsAt: number; bodyExpiresAt: number; expiresAt: number; nextAttemptAt: number;
  content: WhatsAppCiphertext | null; leaseId?: string;
}
export interface WhatsAppOutbox {
  businessId: string; phoneNumberId: string; wabaId: string; conversationId: string;
  state: 'ready' | 'sending' | 'accepted' | 'delivered' | 'unknown' | 'failed' | 'expired';
  createdAt: number; windowEndsAt: number; bodyExpiresAt: number; expiresAt: number; nextAttemptAt: number;
  content: WhatsAppCiphertext | null; reservation: ResponseQuotaReservation;
  sent: boolean; delivered: boolean; read: boolean; failed: boolean; attempts: number;
  pricing?: z.infer<typeof pricingSchema>; metaMessageId?: string; errorCode?: number;
}
export const inboundContentSchema = z.object({ from: z.string().regex(/^[1-9]\d{7,14}$/), text: z.string().min(1).max(4096), messageId: wamid, name: z.string().max(256).optional() }).strict();
export const outboundContentSchema = z.object({ to: z.string().regex(/^[1-9]\d{7,14}$/), reply: z.string().min(1).max(4096), messageId: wamid }).strict();
const historySchema = z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4096) }).strict()).max(20);
export function usageMonth(now = Date.now()): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit' }).format(now); }
const counters = (): WhatsAppUsageCounters => ({ sent: 0, delivered: 0, read: 0, failed: 0, unknown: 0, serviceDelivered: 0, utilityDelivered: 0, marketingDelivered: 0, otherDelivered: 0, freeDelivered: 0, regularDelivered: 0, unknownPricingDelivered: 0 });
function contribution(row: WhatsAppOutbox): WhatsAppUsageCounters {
  const result = counters();
  result.sent = Number(row.sent); result.delivered = Number(row.delivered); result.read = Number(row.read); result.failed = Number(row.failed); result.unknown = Number(row.state === 'unknown');
  if (row.delivered) {
    const category = row.pricing?.category;
    result[category === 'service' ? 'serviceDelivered' : category === 'utility' ? 'utilityDelivered' : category === 'marketing' || category === 'marketing_lite' ? 'marketingDelivered' : 'otherDelivered'] = 1;
    result[row.pricing?.type === 'regular' ? 'regularDelivered' : row.pricing?.type.startsWith('free_') ? 'freeDelivered' : 'unknownPricingDelivered'] = 1;
  }
  return result;
}
export async function updateWhatsAppOutbox(id: string, update: (previous: WhatsAppOutbox) => Partial<WhatsAppOutbox> | null, db: Firestore): Promise<void> {
  const reference = db.collection('whatsappOutbox').doc(id);
  await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return;
    const previous = snapshot.data() as WhatsAppOutbox;
    const patch = update(previous);
    if (!patch) return;
    const next = { ...previous, ...patch };
    const month = usageMonth(previous.createdAt);
    const aggregate = db.collection('whatsappUsage').doc(month);
    const business = aggregate.collection('businesses').doc(previous.businessId);
    const [total, byBusiness] = await Promise.all([transaction.get(aggregate), transaction.get(business)]);
    const before = contribution(previous), after = contribution(next);
    const add = (saved: Record<string, unknown> | undefined) => Object.fromEntries(Object.keys(before).map(key => {
      const name = key as keyof WhatsAppUsageCounters;
      const value = saved?.[name] ?? 0;
      if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid WhatsApp aggregate');
      return [name, (value as number) + after[name] - before[name]];
    }));
    transaction.set(reference, next);
    transaction.set(aggregate, add(total.data()));
    transaction.set(business, add(byBusiness.data()));
  });
}

export async function ingestWhatsAppWebhook(payload: unknown, db: Firestore = getAdminDb(), now = Date.now()): Promise<void> {
  const config = readWhatsAppConfig();
  if (!config.enabled || !config.configured) throw new HttpError(503, 'WhatsApp no está configurado.');
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError(400, 'Webhook no válido.');
  let eventCount = 0;
  // Parse and bound the whole batch before writing any part of it.
  const events: { wabaId: string; value: z.infer<typeof valueSchema> }[] = [];
  for (const entry of parsed.data.entry) for (const change of entry.changes) {
    if (change.field !== 'messages') continue;
    const value = valueSchema.safeParse(change.value);
    if (!value.success) throw new HttpError(400, 'Webhook no válido.');
    eventCount += (value.data.messages?.length ?? 0) + (value.data.statuses?.length ?? 0);
    if (eventCount > 100) throw new HttpError(413, 'Demasiados eventos.');
    events.push({ wabaId: entry.id, value: value.data });
  }
  for (const { wabaId, value } of events) {
    const phoneNumberId = value.metadata.phone_number_id;
    const numberRef = db.collection('whatsappNumbers').doc(phoneNumberId);
    const snapshot = await numberRef.get();
    if (!snapshot.exists) continue;
    const binding = parseWhatsAppBinding(snapshot.data());
    if (binding.wabaId !== wabaId) continue;
    for (const message of value.messages ?? []) {
      if (!bindingReady(binding, config) || message.type !== 'text' || !message.text || message.timestamp > now + 300_000) continue;
      const id = whatsappHash(phoneNumberId, message.id);
      const reference = db.collection('whatsappInbox').doc(id);
      const receivedAt = Math.min(now, message.timestamp);
      const windowEndsAt = receivedAt + WHATSAPP_DAY;
      const content = windowEndsAt <= now ? null : encryptWhatsApp({ from: message.from, text: message.text.body, messageId: message.id,
        ...(value.contacts?.find(contact => contact.wa_id === message.from)?.profile?.name ? { name: value.contacts.find(contact => contact.wa_id === message.from)!.profile!.name } : {}),
      }, reference.path);
      await db.runTransaction(async transaction => {
        const [existing, latestNumber] = await Promise.all([transaction.get(reference), transaction.get(numberRef)]);
        if (existing.exists || !latestNumber.exists) return;
        const latest = parseWhatsAppBinding(latestNumber.data());
        if (!bindingReady(latest, config) || latest.businessId !== binding.businessId || latest.wabaId !== wabaId) return;
        const record: WhatsAppInbox = { businessId: binding.businessId, phoneNumberId, wabaId, conversationId: whatsappHash(binding.businessId, phoneNumberId, message.from),
          state: content ? 'pending' : 'expired', receivedAt, windowEndsAt, bodyExpiresAt: windowEndsAt, expiresAt: now + 30 * WHATSAPP_DAY, nextAttemptAt: content ? now : WHATSAPP_TERMINAL, content };
        transaction.create(reference, record);
        transaction.set(numberRef, { ...latest, lastInboundAt: Math.max(latest.lastInboundAt ?? 0, receivedAt) });
      });
    }
    for (const status of value.statuses ?? []) {
      let id = /^[a-f0-9]{64}$/.test(status.biz_opaque_callback_data ?? '') ? status.biz_opaque_callback_data! : null;
      if (!id) {
        const index = await db.collection('whatsappMessageIds').doc(whatsappHash(phoneNumberId, status.id)).get();
        if (typeof index.data()?.outboxId === 'string') id = index.data()!.outboxId;
      }
      if (!id || !/^[a-f0-9]{64}$/.test(id)) continue;
      const price = pricingSchema.safeParse(status.pricing);
      await updateWhatsAppOutbox(id, previous => {
        if (previous.phoneNumberId !== phoneNumberId || previous.wabaId !== wabaId || (previous.metaMessageId && previous.metaMessageId !== status.id)) return null;
        const delivered = previous.delivered || status.status === 'delivered' || status.status === 'read';
        return { metaMessageId: status.id, sent: previous.sent || ['sent', 'delivered', 'read'].includes(status.status), delivered,
          read: previous.read || status.status === 'read', failed: !delivered && (previous.failed || status.status === 'failed'),
          state: delivered ? 'delivered' : status.status === 'failed' ? 'failed' : status.status === 'sent' ? 'accepted' : previous.state,
          nextAttemptAt: WHATSAPP_TERMINAL, ...(price.success ? { pricing: price.data } : {}),
          ...(status.errors?.[0] ? { errorCode: status.errors[0].code } : {}) };
      }, db);
      if (status.status === 'delivered' || status.status === 'read') {
        await db.runTransaction(async transaction => {
          const latest = await transaction.get(numberRef);
          if (latest.exists) transaction.set(numberRef, { ...latest.data(), lastDeliveredAt: Math.max(Number(latest.data()?.lastDeliveredAt ?? 0), Math.min(now, status.timestamp)) });
        });
      }
    }
  }
}

export async function readWhatsAppHistory(conversationId: string, db: Firestore, now = Date.now()): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const reference = db.collection('whatsappConversations').doc(conversationId);
  const snapshot = await reference.get();
  if (!snapshot.exists || Number(snapshot.data()?.bodyExpiresAt) <= now || !snapshot.data()?.content) return [];
  return historySchema.parse(decryptWhatsApp(snapshot.data()!.content, reference.path));
}
export async function persistWhatsAppReply(id: string, leaseId: string, response: ChatResponse, reservation: ResponseQuotaReservation, db: Firestore): Promise<void> {
  const reference = db.collection('whatsappInbox').doc(id), outbox = db.collection('whatsappOutbox').doc(id);
  if (!response.reply.trim() || response.reply.length > 4096) throw new HttpError(503, 'La respuesta supera el límite de WhatsApp.');
  await db.runTransaction(async transaction => {
    const [inboxSnapshot, existing] = await Promise.all([transaction.get(reference), transaction.get(outbox)]);
    if (existing.exists) return;
    if (!inboxSnapshot.exists) throw new Error('Missing inbox');
    const inbox = inboxSnapshot.data() as WhatsAppInbox;
    if (inbox.state !== 'processing' || inbox.leaseId !== leaseId || !inbox.content || inbox.bodyExpiresAt <= Date.now()) throw new Error('Lost inbox lease');
    const source = inboundContentSchema.parse(decryptWhatsApp(inbox.content, reference.path));
    const historyRef = db.collection('whatsappConversations').doc(inbox.conversationId);
    const historyDoc = await transaction.get(historyRef);
    const activeHistory = historyDoc.exists && Number(historyDoc.data()?.bodyExpiresAt) > Date.now() && historyDoc.data()?.content;
    const history = activeHistory ? historySchema.parse(decryptWhatsApp(historyDoc.data()!.content, historyRef.path)) : [];
    history.push({ role: 'user', content: source.text }, { role: 'assistant', content: response.reply });
    while (history.length > 20 || history.reduce((total, message) => total + message.content.length, 0) > 55_000) history.shift();
    const bodyExpiresAt = activeHistory ? Math.min(Number(historyDoc.data()!.bodyExpiresAt), inbox.bodyExpiresAt) : inbox.bodyExpiresAt;
    const record: WhatsAppOutbox = { businessId: inbox.businessId, phoneNumberId: inbox.phoneNumberId, wabaId: inbox.wabaId, conversationId: inbox.conversationId,
      state: 'ready', createdAt: Date.now(), windowEndsAt: inbox.windowEndsAt, bodyExpiresAt: inbox.bodyExpiresAt, expiresAt: inbox.expiresAt, nextAttemptAt: Date.now(),
      content: encryptWhatsApp({ to: source.from, reply: response.reply, messageId: source.messageId }, outbox.path), reservation,
      sent: false, delivered: false, read: false, failed: false, attempts: 0 };
    transaction.create(outbox, record);
    transaction.set(reference, { ...inbox, state: 'completed', nextAttemptAt: WHATSAPP_TERMINAL });
    transaction.set(historyRef, { content: encryptWhatsApp(history, historyRef.path), bodyExpiresAt, expiresAt: inbox.expiresAt });
  });
}

export async function cleanupWhatsAppRetention(db: Firestore = getAdminDb(), now = Date.now()): Promise<{ morePending: boolean }> {
  let morePending = false;
  for (const collection of ['whatsappInbox', 'whatsappOutbox', 'whatsappConversations']) {
    const expiredBodies = await db.collection(collection).where('bodyExpiresAt', '<=', now).limit(100).get();
    morePending ||= expiredBodies.size === 100;
    for (const document of expiredBodies.docs) await db.runTransaction(async transaction => {
      const reference = db.collection(collection).doc(document.id), fresh = await transaction.get(reference);
      if (fresh.exists && Number(fresh.data()?.bodyExpiresAt) <= now) transaction.set(reference, { ...fresh.data(), content: null, bodyExpiresAt: WHATSAPP_TERMINAL });
    });
  }
  for (const collection of ['whatsappInbox', 'whatsappOutbox', 'whatsappConversations', 'whatsappMessageIds']) {
    const expired = await db.collection(collection).where('expiresAt', '<=', now).limit(100).get();
    morePending ||= expired.size === 100;
    for (const document of expired.docs) await db.runTransaction(async transaction => {
      const reference = db.collection(collection).doc(document.id), fresh = await transaction.get(reference);
      if (fresh.exists && Number(fresh.data()?.expiresAt) <= now) transaction.delete(reference);
    });
  }
  return { morePending };
}
export async function getWhatsAppUsage(db: Firestore = getAdminDb(), now = Date.now()): Promise<WhatsAppUsage> {
  const month = usageMonth(now), reference = db.collection('whatsappUsage').doc(month);
  const [total, businesses] = await Promise.all([reference.get(), reference.collection('businesses').limit(101).get()]);
  const safeCounters = (data: Record<string, unknown> | undefined) => Object.fromEntries(Object.keys(counters()).map(key => {
    const value = data?.[key] ?? 0;
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid WhatsApp aggregate');
    return [key, value];
  })) as unknown as WhatsAppUsageCounters;
  return { month, timeZone: 'America/Bogota', source: 'meta_webhooks', cohort: 'generated_month', invoice: false, estimatedCostCOP: null, totals: safeCounters(total.data()), businesses: businesses.docs.slice(0, 100).map(document => ({ businessId: document.id, ...safeCounters(document.data()) })), truncated: businesses.size > 100 };
}
