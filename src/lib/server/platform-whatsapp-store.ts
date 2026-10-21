import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database } from '@/lib/storage/types';
import type { PlatformWhatsAppStatus } from '@/types/platform-whatsapp';
import {
  PLATFORM_DIGEST_PATTERN, PLATFORM_ID_PATTERN, PLATFORM_PHONE_PATTERN, PLATFORM_METADATA_TTL,
  isPlatformWhatsAppConnectionRecord, isPlatformWhatsAppControlRecord,
  type PlatformWhatsAppScope, type PlatformWhatsAppIdentity, type PlatformWhatsAppConnectionRecord, type PlatformWhatsAppControlRecord,
} from '../../../shared/platform-whatsapp-records';
import { getPlatformWhatsAppConfig, publicPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { HttpError } from './http';

/** Frozen 9243 exports: d=status, T=connection control, O/B=schemas,
 * W=identity, h=same scope, z=normalize, a=control identity, u=replay,
 * b=ISO, x=now guard, X=conflict error, r=unavailable error. */
const controlFields = {
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,128}(?![\s\S])/),
};
export const platformWhatsAppConversationControlSchema = z.object({
  ...controlFields, conversationId: z.string().regex(PLATFORM_DIGEST_PATTERN), mode: z.enum(['human', 'review', 'bot']),
}).strict();
export const platformWhatsAppConnectionControlSchema = z.discriminatedUnion('action', [
  z.object({ ...controlFields, action: z.literal('pause') }).strict(),
  z.object({ ...controlFields, action: z.literal('resume') }).strict(),
  z.object({ ...controlFields, action: z.literal('disconnect') }).strict(),
  z.object({ ...controlFields, action: z.literal('record_connected'), wabaId: z.string().regex(PLATFORM_ID_PATTERN), phoneE164: z.string().regex(PLATFORM_PHONE_PATTERN), phoneNumberId: z.string().regex(PLATFORM_ID_PATTERN) }).strict(),
]);
export const platformWhatsAppConflictError = () => new HttpError(409, 'El estado de WhatsApp cambió o la solicitud no coincide.');
export const platformWhatsAppUnavailableError = () => new HttpError(503, 'El estado de WhatsApp no está disponible.');
export const platformWhatsAppIsoTime = (value: number | null): string | null => value === null ? null : new Date(value).toISOString();

export function assertPlatformWhatsAppNow(now: number): void {
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - PLATFORM_METADATA_TTL) throw new HttpError(400, 'Fecha no válida.');
}
export function samePlatformWhatsAppScope(left: PlatformWhatsAppScope, right: PlatformWhatsAppScope): boolean {
  return left.wabaId === right.wabaId && left.phoneE164 === right.phoneE164 && left.phoneNumberId === right.phoneNumberId;
}
export function platformWhatsAppIdentity(scope: PlatformWhatsAppScope): PlatformWhatsAppIdentity {
  return { version: 1, provider: 'ycloud', purpose: 'platform_support', wabaId: scope.wabaId, phoneE164: scope.phoneE164, phoneNumberId: scope.phoneNumberId };
}
export function normalizePlatformWhatsAppConnection(value: unknown, scope: PlatformWhatsAppScope | null, now: number): PlatformWhatsAppConnectionRecord {
  if (value !== undefined) {
    if (!isPlatformWhatsAppConnectionRecord(value) || (scope && !samePlatformWhatsAppScope(value, scope))) throw platformWhatsAppUnavailableError();
    return value;
  }
  if (!scope) throw platformWhatsAppUnavailableError();
  return { ...platformWhatsAppIdentity(scope), recordType: 'connection', connectionRevision: 0, providerConnection: 'unverified', paused: false, pausedReason: null,
    updatedAt: now, connectedAt: null, connectedRevision: null, lastSignedInboundAt: null, lastHumanEchoAt: null, lastDeliveryAt: null };
}
export function platformWhatsAppControlIdentity(actorUid: string, requestId: string, parsedBody: unknown): { id: string; fingerprint: string } {
  if (typeof actorUid !== 'string' || !actorUid.length || actorUid.length > 128) throw new HttpError(400, 'Actor no válido.');
  const digest = (domain: string, parts: unknown[]) => createHash('sha256').update(JSON.stringify(['sarin/platform-whatsapp', 1, domain, ...parts])).digest('hex');
  return { id: 'control_' + digest('admin-request', [actorUid, requestId]), fingerprint: digest('admin-body', [parsedBody]) };
}
export function isPlatformWhatsAppControlReplay(value: unknown, fingerprint: string, now: number): boolean {
  if (value === undefined) return false;
  if (!isPlatformWhatsAppControlRecord(value)) throw platformWhatsAppUnavailableError();
  if (value.expiresAt <= now) return false;
  if (value.fingerprint !== fingerprint) throw platformWhatsAppConflictError();
  return true;
}
export async function getPlatformWhatsAppStatus(database: Database = getAdminDb(), now = Date.now()): Promise<PlatformWhatsAppStatus> {
  assertPlatformWhatsAppNow(now);
  const config = getPlatformWhatsAppConfig();
  const snapshot = await database.collection('serverSettings').doc('platform_whatsapp').get();
  const connection = snapshot.exists || config.scope ? normalizePlatformWhatsAppConnection(snapshot.data(), config.scope, now) : null;
  const audit = (connection ? (await database.collection('platformWhatsAppEvents').where('phoneNumberId', '==', connection.phoneNumberId)
    .where('state', '==', 'connection_control').orderBy('updatedAt', 'desc').limit(51).get()).docs : [])
    .map(doc => doc.data()).filter((value): value is PlatformWhatsAppControlRecord => isPlatformWhatsAppControlRecord(value) && samePlatformWhatsAppScope(value, connection!) && value.expiresAt > now)
    .sort((left, right) => right.resultRevision - left.resultRevision).slice(0, 50);
  const providerConnection = connection?.providerConnection ?? 'unverified';
  const presentationState = providerConnection === 'disconnected' ? 'disconnected' : connection?.paused ? 'paused' : !config.configured ? 'not_configured'
    : providerConnection === 'unverified' ? 'configured_unverified' : config.receiveEnabled && (connection?.lastSignedInboundAt !== null || connection?.lastHumanEchoAt !== null) ? 'receiving_human' : 'automation_blocked';
  return { ...publicPlatformWhatsAppConfig(config), providerConnection, connectionRevision: connection?.connectionRevision ?? 0,
    lastSignedInboundAt: platformWhatsAppIsoTime(connection?.lastSignedInboundAt ?? null), lastHumanEchoAt: platformWhatsAppIsoTime(connection?.lastHumanEchoAt ?? null), lastDeliveryAt: null,
    connectedAt: platformWhatsAppIsoTime(connection?.connectedAt ?? null), connectedBy: audit.find(value => value.action === 'record_connected' && value.resultRevision === connection?.connectedRevision)?.actorUid ?? null,
    pausedReason: connection?.pausedReason ?? null, presentationState, observedAt: new Date(now).toISOString(),
    audit: audit.map(value => ({ action: value.action, actorUid: value.actorUid, at: new Date(value.receivedAt).toISOString(), expiresAt: new Date(value.expiresAt).toISOString(), revision: value.resultRevision })) };
}
/** Actor authentication belongs to the trusted administrative caller. */
export async function applyPlatformWhatsAppConnectionControl(input: unknown, actorUid: string, database: Database = getAdminDb(), now = Date.now()): Promise<PlatformWhatsAppStatus> {
  assertPlatformWhatsAppNow(now);
  const parsed = platformWhatsAppConnectionControlSchema.safeParse(input);
  if (!parsed.success) throw new HttpError(400, 'Control no válido.');
  const body = parsed.data, config = getPlatformWhatsAppConfig(), control = platformWhatsAppControlIdentity(actorUid, body.requestId, body);
  const connectionRef = database.collection('serverSettings').doc('platform_whatsapp'), auditRef = database.collection('platformWhatsAppEvents').doc(control.id);
  await database.runTransaction(async transaction => {
    const [snapshot, audit] = await Promise.all([transaction.get(connectionRef), transaction.get(auditRef)]);
    const connection = normalizePlatformWhatsAppConnection(snapshot.data(), config.scope, now);
    if (isPlatformWhatsAppControlReplay(audit.data(), control.fingerprint, now)) return;
    if (connection.connectionRevision !== body.expectedRevision || connection.connectionRevision === Number.MAX_SAFE_INTEGER
      || (body.action === 'record_connected' && (!config.configured || !config.scope || !samePlatformWhatsAppScope(body, config.scope)))
      || (body.action === 'resume' && (!config.configured || connection.providerConnection !== 'connected'))) throw platformWhatsAppConflictError();
    const updated = { ...connection, connectionRevision: connection.connectionRevision + 1, updatedAt: now };
    if (updated.observationStatus !== undefined) { updated.observationStatus = 'none'; updated.observationRevision = null; updated.observedAt = null; }
    if (body.action === 'pause') { updated.paused = true; updated.pausedReason = connection.providerConnection === 'disconnected' ? 'disconnected' : 'manual'; }
    if (body.action === 'disconnect') { updated.providerConnection = 'disconnected'; updated.paused = true; updated.pausedReason = 'disconnected'; }
    if (body.action === 'record_connected') {
      updated.providerConnection = 'connected'; updated.connectedAt = now; updated.connectedRevision = updated.connectionRevision;
      if (updated.pausedReason === 'disconnected') updated.pausedReason = 'manual';
    }
    if (body.action === 'resume') { updated.paused = false; updated.pausedReason = null; }
    const record: PlatformWhatsAppControlRecord = { ...platformWhatsAppIdentity(connection), recordType: 'control', state: 'connection_control', receivedAt: now, updatedAt: now,
      expiresAt: now + PLATFORM_METADATA_TTL, actorUid, fingerprint: control.fingerprint, action: body.action, targetId: 'platform_whatsapp', resultRevision: updated.connectionRevision };
    transaction.set(connectionRef, updated); transaction.set(auditRef, record);
  });
  return getPlatformWhatsAppStatus(database, now);
}
