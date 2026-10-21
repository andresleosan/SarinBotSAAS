/** Pure record contracts restored from the published platform WhatsApp format. */
export const PLATFORM_BODY_TTL = 86_400_000;
export const PLATFORM_METADATA_TTL = 2_592_000_000;
export const PLATFORM_DIGEST_PATTERN = /^[a-f0-9]{64}(?![\s\S])/;
export const PLATFORM_ID_PATTERN = /^\d{5,30}(?![\s\S])/;
export const PLATFORM_PHONE_PATTERN = /^\+[1-9]\d{7,14}(?![\s\S])/;

export interface PlatformWhatsAppScope {
  wabaId: string;
  phoneE164: string;
  phoneNumberId: string;
}
export interface PlatformWhatsAppIdentity extends PlatformWhatsAppScope {
  version: 1;
  provider: 'ycloud';
  purpose: 'platform_support';
}
export interface PlatformWhatsAppCiphertext {
  version: 1;
  iv: string;
  tag: string;
  data: string;
}
interface ExpiringMetadata extends PlatformWhatsAppIdentity {
  receivedAt: number;
  expiresAt: number;
}
type ContentState<K extends string> =
  | ({ state: 'body_present' } & Record<K, PlatformWhatsAppCiphertext>)
  | ({ state: 'body_erased' } & Record<K, null>);
export interface PlatformWhatsAppConnectionRecord extends PlatformWhatsAppIdentity {
  recordType: 'connection';
  connectionRevision: number;
  providerConnection: 'unverified' | 'connected' | 'disconnected';
  paused: boolean;
  pausedReason: null | 'manual' | 'disconnected';
  updatedAt: number;
  connectedAt: number | null;
  connectedRevision: number | null;
  lastSignedInboundAt: number | null;
  lastHumanEchoAt: number | null;
  lastDeliveryAt: null;
}
export type PlatformWhatsAppEventRecord = ExpiringMetadata & {
  recordType: 'event';
  connectionRevision: number;
  conversationId: string;
  occurredAt: number;
  canonicalIdentity: string;
  fingerprint: string;
  bodyExpiresAt: number;
} & (
  | (ContentState<'content'> & { kind: 'incoming_text'; customerSentAt?: number | null })
  | (ContentState<'content'> & { kind: 'human_echo' })
  | (ContentState<'content'> & { kind: 'incoming_audio'; customerSentAt: number | null; ingressDisposition: 'descriptor_retained' })
  | { state: 'body_erased'; content: null; kind: 'incoming_audio' | 'incoming_choice'; customerSentAt: number | null; ingressDisposition: 'control_only' }
);
export interface PlatformWhatsAppAliasRecord extends ExpiringMetadata {
  recordType: 'alias';
  state: 'metadata';
  canonicalEventId: string;
  conversationId: string;
  fingerprint: string;
  bodyExpiresAt: number;
}
export interface PlatformWhatsAppConflictRecord extends ExpiringMetadata {
  recordType: 'conflict';
  state: 'metadata';
  conversationId: string;
  fingerprint: string;
}
export type PlatformWhatsAppControlRecord = ExpiringMetadata & {
  recordType: 'control';
  updatedAt: number;
  actorUid: string;
  fingerprint: string;
  resultRevision: number;
} & (
  | { state: 'connection_control'; targetId: 'platform_whatsapp'; action: 'pause' | 'resume' | 'disconnect' | 'record_connected' }
  | { state: 'conversation_control'; targetId: string; action: 'human' | 'review' }
);
export type PlatformWhatsAppConversationRecord = PlatformWhatsAppIdentity & ContentState<'contactContent'> & {
  recordType: 'conversation';
  mode: 'human' | 'review';
  revision: number;
  updatedAt: number;
  lastInboundAt: number | null;
  lastHumanAt: number | null;
  bodyExpiresAt: number;
  expiresAt: number;
  previewOccurredAt: number;
  previewReceivedAt: number;
  canonicalIdentity: string;
  conflictAt: number | null;
};
export type PlatformWhatsAppStoredEvent = PlatformWhatsAppEventRecord | PlatformWhatsAppAliasRecord | PlatformWhatsAppConflictRecord | PlatformWhatsAppControlRecord;

type UnknownRecord = Record<string, unknown>;
const isObject = (value: unknown): value is UnknownRecord => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000;
const isNullableInteger = (value: unknown) => value === null || isInteger(value);
const isDigest = (value: unknown) => typeof value === 'string' && PLATFORM_DIGEST_PATTERN.test(value);
const hasExactKeys = (value: UnknownRecord, keys: string[]) => Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
const identityKeys = ['version', 'provider', 'purpose', 'wabaId', 'phoneE164', 'phoneNumberId'];
const metadataKeys = [...identityKeys, 'receivedAt', 'expiresAt'];

/** Structural scope guard; unlike configuration schemas, extra fields are allowed. */
export function isPlatformWhatsAppScope(value: unknown): value is PlatformWhatsAppScope {
  return isObject(value) && typeof value.wabaId === 'string' && PLATFORM_ID_PATTERN.test(value.wabaId)
    && typeof value.phoneNumberId === 'string' && PLATFORM_ID_PATTERN.test(value.phoneNumberId)
    && typeof value.phoneE164 === 'string' && PLATFORM_PHONE_PATTERN.test(value.phoneE164);
}
export function isPlatformWhatsAppCiphertext(value: unknown): value is PlatformWhatsAppCiphertext {
  return isObject(value) && hasExactKeys(value, ['version', 'iv', 'tag', 'data']) && value.version === 1
    && typeof value.iv === 'string' && /^[A-Za-z0-9+/]{16}$/.test(value.iv)
    && typeof value.tag === 'string' && /^[A-Za-z0-9+/]{22}==$/.test(value.tag)
    && typeof value.data === 'string' && value.data.length >= 4 && value.data.length <= 333336
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.data);
}
function isIdentity(value: unknown): value is UnknownRecord & PlatformWhatsAppIdentity {
  return isObject(value) && value.version === 1 && value.provider === 'ycloud' && value.purpose === 'platform_support' && isPlatformWhatsAppScope(value);
}
function isMetadata(value: unknown): value is UnknownRecord & ExpiringMetadata {
  return isIdentity(value) && isInteger(value.receivedAt) && isInteger(value.expiresAt)
    && value.expiresAt === value.receivedAt + PLATFORM_METADATA_TTL;
}
function hasContent(value: UnknownRecord, field: string): boolean {
  return isInteger(value.bodyExpiresAt) && (
    (value.state === 'body_erased' && value[field] === null)
    || (value.state === 'body_present' && isPlatformWhatsAppCiphertext(value[field]))
  );
}
export function isPlatformWhatsAppConnectionRecord(value: unknown): value is PlatformWhatsAppConnectionRecord {
  return isIdentity(value) && hasExactKeys(value, [...identityKeys, 'recordType', 'connectionRevision', 'providerConnection', 'paused', 'pausedReason', 'updatedAt', 'connectedAt', 'connectedRevision', 'lastSignedInboundAt', 'lastHumanEchoAt', 'lastDeliveryAt'])
    && value.recordType === 'connection' && isInteger(value.connectionRevision)
    && ['unverified', 'connected', 'disconnected'].includes(value.providerConnection as string)
    && typeof value.paused === 'boolean' && [null, 'manual', 'disconnected'].includes(value.pausedReason as string | null)
    && isInteger(value.updatedAt) && isNullableInteger(value.connectedAt) && isNullableInteger(value.connectedRevision)
    && isNullableInteger(value.lastSignedInboundAt) && isNullableInteger(value.lastHumanEchoAt) && value.lastDeliveryAt === null
    && (value.providerConnection !== 'disconnected' || (value.paused && value.pausedReason === 'disconnected'));
}
export function isPlatformWhatsAppEventRecord(value: unknown): value is PlatformWhatsAppEventRecord {
  if (!isMetadata(value)) return false;
  const newer = value.kind === 'incoming_audio' || value.kind === 'incoming_choice';
  const timed = newer || (value.kind === 'incoming_text' && Object.hasOwn(value, 'customerSentAt'));
  const keys = [...metadataKeys, 'recordType', 'state', 'connectionRevision', 'conversationId', 'kind', 'occurredAt', 'canonicalIdentity', 'fingerprint', 'bodyExpiresAt', 'content', ...timed ? ['customerSentAt'] : [], ...newer ? ['ingressDisposition'] : []];
  return hasExactKeys(value, keys)
    && value.recordType === 'event' && hasContent(value, 'content') && isInteger(value.connectionRevision)
    && isDigest(value.conversationId) && ['incoming_text', 'human_echo', 'incoming_audio', 'incoming_choice'].includes(value.kind as string)
    && (!timed || (isNullableInteger(value.customerSentAt) && (value.customerSentAt === null || (value.customerSentAt as number) <= value.receivedAt)))
    && (!newer || (value.ingressDisposition === 'control_only' ? value.state === 'body_erased' && value.content === null : value.kind === 'incoming_audio' && value.ingressDisposition === 'descriptor_retained'))
    && isInteger(value.occurredAt) && isDigest(value.canonicalIdentity) && isDigest(value.fingerprint)
    && value.bodyExpiresAt === Math.min(value.occurredAt, value.receivedAt) + PLATFORM_BODY_TTL;
}
export function isPlatformWhatsAppAliasRecord(value: unknown): value is PlatformWhatsAppAliasRecord {
  return isMetadata(value) && hasExactKeys(value, [...metadataKeys, 'recordType', 'state', 'canonicalEventId', 'conversationId', 'fingerprint', 'bodyExpiresAt'])
    && value.recordType === 'alias' && value.state === 'metadata' && typeof value.canonicalEventId === 'string'
    && /^event_[a-f0-9]{64}$/.test(value.canonicalEventId) && isDigest(value.conversationId) && isDigest(value.fingerprint) && isInteger(value.bodyExpiresAt);
}
export function isPlatformWhatsAppConflictRecord(value: unknown): value is PlatformWhatsAppConflictRecord {
  return isMetadata(value) && hasExactKeys(value, [...metadataKeys, 'recordType', 'state', 'conversationId', 'fingerprint'])
    && value.recordType === 'conflict' && value.state === 'metadata' && isDigest(value.conversationId) && isDigest(value.fingerprint);
}
export function isPlatformWhatsAppControlRecord(value: unknown): value is PlatformWhatsAppControlRecord {
  return isMetadata(value) && hasExactKeys(value, [...metadataKeys, 'recordType', 'state', 'updatedAt', 'actorUid', 'fingerprint', 'action', 'targetId', 'resultRevision'])
    && value.recordType === 'control' && ['connection_control', 'conversation_control'].includes(value.state as string)
    && value.updatedAt === value.receivedAt && typeof value.actorUid === 'string' && value.actorUid.length > 0 && value.actorUid.length <= 128
    && isDigest(value.fingerprint) && isInteger(value.resultRevision)
    && (value.state === 'connection_control'
      ? value.targetId === 'platform_whatsapp' && ['pause', 'resume', 'disconnect', 'record_connected'].includes(value.action as string)
      : isDigest(value.targetId) && ['human', 'review'].includes(value.action as string));
}
export function isPlatformWhatsAppConversationRecord(value: unknown): value is PlatformWhatsAppConversationRecord {
  return isIdentity(value) && hasExactKeys(value, [...identityKeys, 'recordType', 'state', 'mode', 'revision', 'updatedAt', 'lastInboundAt', 'lastHumanAt', 'bodyExpiresAt', 'expiresAt', 'previewOccurredAt', 'previewReceivedAt', 'canonicalIdentity', 'contactContent', 'conflictAt'])
    && value.recordType === 'conversation' && hasContent(value, 'contactContent') && ['human', 'review'].includes(value.mode as string)
    && isInteger(value.revision) && isInteger(value.updatedAt) && isInteger(value.expiresAt)
    && isNullableInteger(value.lastInboundAt) && isNullableInteger(value.lastHumanAt)
    && isInteger(value.previewOccurredAt) && isInteger(value.previewReceivedAt)
    && value.bodyExpiresAt === Math.min(value.previewOccurredAt, value.previewReceivedAt) + PLATFORM_BODY_TTL
    && isDigest(value.canonicalIdentity) && isNullableInteger(value.conflictAt);
}
export function isPlatformWhatsAppStoredEvent(value: unknown): value is PlatformWhatsAppStoredEvent {
  return isPlatformWhatsAppEventRecord(value) || isPlatformWhatsAppAliasRecord(value) || isPlatformWhatsAppConflictRecord(value) || isPlatformWhatsAppControlRecord(value);
}
