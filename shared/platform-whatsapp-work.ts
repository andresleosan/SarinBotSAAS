import { isPlatformWhatsAppCiphertext, isPlatformWhatsAppScope, PLATFORM_BODY_TTL, PLATFORM_METADATA_TTL, type PlatformWhatsAppCiphertext, type PlatformWhatsAppIdentity } from './platform-whatsapp-records.ts';
import { createPlatformMenu, parsePlatformMenuChoice } from './platform-whatsapp-menu.ts';

export type WorkHint = { jobId: string; epoch: string };
export type Lease = WorkHint & { token: string };
export type DeliveryResult = { status: 'accepted'; providerId: string } | { status: 'rejected' | 'unknown' | 'cancelled' };
export type CostStage = 'audio' | 'generation' | 'send';
export const WORK_LEASE_MS = 60_000, WORK_RENEW_MS = 20_000, WORK_DEADLINE_MS = 120_000;
export const workCatalog = {
  identification: { text: 'Soy SarinBot, el asistente de soporte de SarinBot. Consulta las condiciones de soporte y tratamiento de datos y vincula tu cuenta en la sección Ayuda de la aplicación. Aceptar abre el menú; no acepta documentos ni vincula tu cuenta.', purpose: 'notice' },
  identification_audio: { text: 'Soy SarinBot, el asistente de soporte de SarinBot. Consulta las condiciones de soporte y tratamiento de datos y vincula tu cuenta en la sección Ayuda de la aplicación. Aceptar abre el menú; no acepta documentos ni vincula tu cuenta. No procesé este audio. Después de vincular tu cuenta y habilitar el soporte, envíalo de nuevo.', purpose: 'notice' },
  support_menu: { text: 'Elige Soporte, Planes y suscripción o Atención humana.', purpose: 'support' },
  permission: { text: 'Abre la sección Ayuda de la aplicación para vincular tu cuenta y revisar los permisos de soporte. Después, envía un mensaje nuevo y elige Soporte o Planes y suscripción.', purpose: 'reply' },
  support_ready: { text: 'El soporte de SarinBot está habilitado para esta conversación. Escríbeme tu consulta o envía una nota de voz de hasta dos minutos.', purpose: 'reply' },
  plans_ready: { text: 'El soporte de SarinBot está habilitado para esta conversación. Escríbeme tu consulta sobre planes y suscripciones.', purpose: 'reply' },
  audio_fallback: { text: 'No pude transcribir ese audio. Escríbeme tu consulta o envía una nota de voz de hasta dos minutos. También puedes pedir atención humana.', purpose: 'reply' },
} as const;
export type CatalogId = keyof typeof workCatalog;
export type ActorAuthority = { authorityKind: 'actor'; uid: string; confirmedAuthTime: number; linkId: string; linkRevision: number; accountRevision: number; accountFingerprint: string; accountReceiptId: string; supportRevision: number; supportFingerprint: string; supportReceiptId: string };
export type NoticeAuthority = { authorityKind: 'fixed_notice'; noticeId: CatalogId; noticeVersion: 1 };
export type WorkAuthority = ActorAuthority | NoticeAuthority;
export type StageState = 'not_applicable' | 'not_started' | 'preparing' | 'started' | 'result_pending' | 'completed' | 'failed' | 'unknown' | 'cancelled';
export type WorkStages = { [P in 'audio' | 'generation' as `${P}State`]: StageState }
  & { [P in 'audio' | 'generation' as `${P}${'Token' | 'LeaseToken' | 'ReservationId'}`]: string | null }
  & { [P in 'audio' | 'generation' as `${P}${'StartedAt' | 'FinishedAt'}`]: number | null };
export interface ControlHead extends PlatformWhatsAppIdentity {
  recordType: 'control_head'; conversationId: string; controlEpoch: string; controlRevision: number; connectionRevision: number;
  entryState: 'initial' | 'bot' | 'human_paused'; botAuthorityFingerprint: string | null; attachedConversationRevision: number | null;
  headJobId: string | null; tailJobId: string | null; currentMenuOutboxId: string | null;
  status: 'idle' | 'active' | 'advance' | 'repair_needed'; nextAttemptAt: number | null; receivedAt: number; expiresAt: number;
}
interface SourceBinding extends PlatformWhatsAppIdentity {
  jobId: string; epoch: string; sourceEventId: string; conversationId: string; controlEpoch: string; controlRevision: number;
  connectionRevision: number; conversationRevision: number | null; sourceOccurredAt: number; sourceReceivedAt: number;
  customerSentAt: number | null; windowExpiresAt: number | null; bodyExpiresAt: number; expiresAt: number; createdAt: number;
  requestFingerprint: string; bodyState: 'body_present' | 'body_erased'; content: PlatformWhatsAppCiphertext | null;
  catalogId: CatalogId | null; catalogVersion: 1 | null;
}
export type PlatformJob = SourceBinding & WorkAuthority & WorkStages & {
  recordType: 'job'; sourceKind: 'text' | 'audio' | 'menu'; kind: 'control' | 'customer_reply' | 'admin_query' | 'operator_notification';
  status: 'waiting' | 'ready' | 'leased' | 'reply_saved' | 'completed' | 'cancelled' | 'unknown';
  nextJobId: string | null; nextAttemptAt: number | null; leaseToken: string | null; leaseClaimedAt: number | null; leaseExpiresAt: number | null;
  processingStartedAt: number | null; processingDeadlineAt: number | null; outboxId: string | null; outputKind: 'none' | 'generated' | 'catalog' | 'audio_fallback';
};
export type PlatformOutbox = SourceBinding & WorkAuthority & {
  recordType: 'outbox'; outboxId: string; outputFingerprint: string; outputKind: 'generated' | 'catalog' | 'audio_fallback';
  menuPurpose: 'notice' | 'support' | 'admin' | 'reply'; menuVersion: 1; menuActions: string[];
  consumedByEventId: string | null; consumedAt: number | null;
  status: 'prepared' | 'claimed' | 'started' | 'accepted' | 'rejected' | 'unknown' | 'cancelled';
  sendToken: string | null; sendClaimedAt: number | null; sendStartedAt: number | null; sendFinishedAt: number | null;
  providerId: string | null; sendReservationId: string | null;
  deliveryStatus?: 'unobserved' | 'accepted' | 'sent' | 'delivered' | 'read'; deliveryFailed?: boolean; deliveryObservedAt?: number | null;
};
export type Usage = { usageAudioMilliseconds: number | null; usageInputTokens: number | null; usageOutputTokens: number | null; usageMessages: number | null };
export const emptyUsage: Usage = { usageAudioMilliseconds: null, usageInputTokens: null, usageOutputTokens: null, usageMessages: null };
export type GenerationQuote = { requestDigest: string; requestBytes: number; inputUpper: number; outputCap: 4096; provider: 'deepseek'; requestedModel: 'deepseek-flash'; modelPolicy: string; maximumMicros: number };
export function isGenerationQuote(v: unknown): v is GenerationQuote {
  return workObject(v) && workExact(v, ['requestDigest', 'requestBytes', 'inputUpper', 'outputCap', 'provider', 'requestedModel', 'modelPolicy', 'maximumMicros']) && workDigest(v.requestDigest) && workInteger(v.requestBytes) && v.requestBytes > 0 && v.requestBytes <= 128000 && v.inputUpper === v.requestBytes + 4096 && v.outputCap === 4096 && v.provider === 'deepseek' && v.requestedModel === 'deepseek-flash' && workDigest(v.modelPolicy) && v.maximumMicros === Math.ceil((v.requestBytes + 4096) * 300 / 1000) + Math.ceil(4096 * 1200 / 1000);
}
export interface BudgetCall extends PlatformWhatsAppIdentity, Usage {
  quote?: GenerationQuote;
  recordType: 'budget_call'; reservationId: string; jobId: string; epoch: string; stage: CostStage; requestFingerprint: string;
  maximumMicros: number; actualMicros: number | null; tariffVersion: string; policyFingerprint: string; periodId: string; circuitId: string;
  createdAt: number; expiresAt: number; status: 'reserved' | 'started' | 'uncertain' | 'settled' | 'released';
  effectToken: string | null; startedAt: number | null; finishedAt: number | null;
}
export interface BudgetPeriod extends PlatformWhatsAppIdentity, Usage {
  recordType: 'budget_period'; periodId: string; stage: CostStage; dayStart: number; dayEnd: number;
  usedMicros: number; heldMicros: number; overrunMicros: number; expiresAt: number;
}
export interface BudgetCircuit extends PlatformWhatsAppIdentity {
  recordType: 'budget_circuit'; circuitId: string; stage: CostStage; status: 'open' | 'blocked'; policyFingerprint: string;
  createdAt: number; expiresAt: number; trippedAt: number | null; reason: 'overrun' | 'accounting_invalid' | null;
}
export interface ContactRate extends PlatformWhatsAppIdentity { recordType: 'contact_rate'; conversationId: string; acceptedAt: number[]; expiresAt: number }
export interface ProviderAlias extends PlatformWhatsAppIdentity { recordType: 'provider_alias'; providerId: string; outboxId: string; jobId: string; epoch: string; expiresAt: number }
export type WorkRecord = ProviderAlias | ControlHead | PlatformJob | PlatformOutbox | BudgetCall | BudgetPeriod | BudgetCircuit | ContactRate;
type R = Record<string, unknown>;
export const workObject = (v: unknown): v is R => !!v && typeof v === 'object' && !Array.isArray(v);
export const workExact = (v: R, keys: readonly string[]) => Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export const workInteger = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export const workTime = (v: unknown): v is number => workInteger(v) && v <= 8_640_000_000_000_000;
export const workDigest = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}(?![\s\S])/.test(v);
export const workUuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/.test(v);
export const workId = (v: unknown, prefix: string): v is string => typeof v === 'string' && v.startsWith(prefix + '_') && workDigest(v.slice(prefix.length + 1));
const nullable = (v: unknown, guard: (v: unknown) => boolean) => v === null || guard(v);
const oneOf = (v: unknown, list: readonly string[]) => typeof v === 'string' && list.includes(v);
const identityKeys = ['version', 'provider', 'purpose', 'wabaId', 'phoneE164', 'phoneNumberId'];
const authorityKeys = (v: R) => v.authorityKind === 'actor' ? ['authorityKind', 'uid', 'confirmedAuthTime', 'linkId', 'linkRevision', 'accountRevision', 'accountFingerprint', 'accountReceiptId', 'supportRevision', 'supportFingerprint', 'supportReceiptId'] : ['authorityKind', 'noticeId', 'noticeVersion'];
const sourceKeys = [...identityKeys, 'jobId', 'epoch', 'sourceEventId', 'conversationId', 'controlEpoch', 'controlRevision', 'connectionRevision', 'conversationRevision', 'sourceOccurredAt', 'sourceReceivedAt', 'customerSentAt', 'windowExpiresAt', 'bodyExpiresAt', 'expiresAt', 'createdAt', 'requestFingerprint', 'bodyState', 'content', 'catalogId', 'catalogVersion'];
const stageKeys = ['audio', 'generation'].flatMap(p => ['State', 'Token', 'LeaseToken', 'ReservationId', 'StartedAt', 'FinishedAt'].map(s => p + s));
const usageKeys = Object.keys(emptyUsage);
const identity = (v: unknown): v is R => workObject(v) && v.version === 1 && v.provider === 'ycloud' && v.purpose === 'platform_support' && isPlatformWhatsAppScope(v);
const identifier = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}(?![\s\S])/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v);
export function workText(v: unknown, kind: 'reply' | 'question' | 'provider'): v is string {
  if (typeof v !== 'string' || !v.trim() || /\0/.test(v)) return false;
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const n = v.charCodeAt(++i); if (!(n >= 0xdc00 && n <= 0xdfff)) return false; }
    else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return kind === 'reply' ? v.length <= 1024 && new TextEncoder().encode(v).length <= 4096
    : [...v].length <= (kind === 'question' ? 4096 : 512) && new TextEncoder().encode(v).length <= (kind === 'question' ? 16384 : 1024) && (kind !== 'provider' || !/[\u0000-\u001f\u007f-\u009f]/.test(v));
}
function authority(v: R): boolean {
  if (v.authorityKind === 'fixed_notice') return typeof v.noticeId === 'string' && ['identification', 'identification_audio', 'support_menu', 'permission'].includes(v.noticeId) && v.noticeVersion === 1 && v.catalogId === v.noticeId && v.catalogVersion === 1;
  return v.authorityKind === 'actor' && typeof v.uid === 'string' && v.uid.length > 0 && v.uid.length <= 128 && !/[\u0000-\u001f]/.test(v.uid)
    && workInteger(v.confirmedAuthTime) && workUuid(v.linkId) && workInteger(v.linkRevision) && v.linkRevision > 0
    && ['account', 'support'].every(p => workInteger(v[p + 'Revision']) && Number(v[p + 'Revision']) > 0 && workDigest(v[p + 'Fingerprint']) && identifier(v[p + 'ReceiptId'])) && workInteger(v.conversationRevision);
}
function source(v: R): boolean {
  return workId(v.jobId, 'job') && workUuid(v.epoch) && workId(v.sourceEventId, 'event') && workDigest(v.conversationId) && workUuid(v.controlEpoch)
    && workInteger(v.controlRevision) && workInteger(v.connectionRevision) && nullable(v.conversationRevision, workInteger)
    && ['sourceOccurredAt', 'sourceReceivedAt', 'bodyExpiresAt', 'expiresAt', 'createdAt'].every(k => workTime(v[k]))
    && Number(v.createdAt) >= Number(v.sourceReceivedAt) && v.bodyExpiresAt === Math.min(Number(v.sourceOccurredAt), Number(v.sourceReceivedAt)) + PLATFORM_BODY_TTL
    && v.expiresAt === Number(v.sourceReceivedAt) + PLATFORM_METADATA_TTL && nullable(v.customerSentAt, workTime)
    && (v.customerSentAt === null ? v.windowExpiresAt === null : Number(v.customerSentAt) <= Number(v.sourceReceivedAt) && workTime(v.windowExpiresAt) && v.windowExpiresAt === Number(v.customerSentAt) + PLATFORM_BODY_TTL)
    && workDigest(v.requestFingerprint) && (v.bodyState === 'body_present' ? isPlatformWhatsAppCiphertext(v.content) : v.bodyState === 'body_erased' && v.content === null)
    && (v.catalogId === null ? v.catalogVersion === null : typeof v.catalogId === 'string' && Object.hasOwn(workCatalog, v.catalogId) && v.catalogVersion === 1) && authority(v);
}
function stage(v: R, prefix: 'audio' | 'generation'): boolean {
  const s = v[prefix + 'State'], t = v[prefix + 'Token'], l = v[prefix + 'LeaseToken'], r = v[prefix + 'ReservationId'], start = v[prefix + 'StartedAt'], finish = v[prefix + 'FinishedAt'];
  if (!oneOf(s, ['not_applicable', 'not_started', 'preparing', 'started', 'result_pending', 'completed', 'failed', 'unknown', 'cancelled']) || !nullable(start, workTime) || !nullable(finish, workTime)) return false;
  if (s === 'not_applicable' || s === 'not_started') return [t, l, r, start, finish].every(x => x === null);
  if (s === 'cancelled' && t === null) return [l, r, start].every(x => x === null) && workTime(finish);
  if (!workUuid(t) || !workUuid(l) || !workId(r, 'call')) return false;
  if (s === 'preparing') return prefix === 'audio' && start === null && finish === null;
  if (s === 'started') return workTime(start) && finish === null;
  if (s === 'result_pending') return prefix === 'audio' && workTime(start) && workTime(finish) && finish >= start;
  return workTime(finish) && (start === null || finish >= Number(start)) && (s !== 'completed' || workTime(start));
}
export function isControlHead(v: unknown): v is ControlHead {
  return identity(v) && workExact(v, [...identityKeys, 'recordType', 'conversationId', 'controlEpoch', 'controlRevision', 'connectionRevision', 'entryState', 'botAuthorityFingerprint', 'attachedConversationRevision', 'headJobId', 'tailJobId', 'currentMenuOutboxId', 'status', 'nextAttemptAt', 'receivedAt', 'expiresAt'])
    && v.recordType === 'control_head' && workDigest(v.conversationId) && workUuid(v.controlEpoch) && workInteger(v.controlRevision) && workInteger(v.connectionRevision)
    && oneOf(v.entryState, ['initial', 'bot', 'human_paused']) && (v.entryState === 'bot' ? workDigest(v.botAuthorityFingerprint) : v.botAuthorityFingerprint === null)
    && nullable(v.attachedConversationRevision, workInteger) && nullable(v.headJobId, x => workId(x, 'job')) && nullable(v.tailJobId, x => workId(x, 'job')) && nullable(v.currentMenuOutboxId, workUuid)
    && nullable(v.nextAttemptAt, workTime) && workTime(v.receivedAt) && workTime(v.expiresAt) && v.expiresAt === v.receivedAt + PLATFORM_METADATA_TTL
    && (v.status === 'idle' ? v.headJobId === null && v.tailJobId === null && v.nextAttemptAt === null : v.status === 'active' ? v.headJobId !== null && v.tailJobId !== null && v.nextAttemptAt === null : v.status === 'advance' ? v.headJobId !== null && v.tailJobId !== null && workTime(v.nextAttemptAt) : v.status === 'repair_needed' && v.nextAttemptAt === null);
}
export function isPlatformJob(v: unknown): v is PlatformJob {
  if (!identity(v) || !workExact(v, [...sourceKeys, ...authorityKeys(v), ...stageKeys, 'recordType', 'sourceKind', 'kind', 'status', 'nextJobId', 'nextAttemptAt', 'leaseToken', 'leaseClaimedAt', 'leaseExpiresAt', 'processingStartedAt', 'processingDeadlineAt', 'outboxId', 'outputKind']) || v.recordType !== 'job' || !source(v) || !stage(v, 'audio') || !stage(v, 'generation')) return false;
  if (!oneOf(v.sourceKind, ['text', 'audio', 'menu']) || !oneOf(v.kind, ['control', 'customer_reply', 'admin_query', 'operator_notification']) || !oneOf(v.status, ['waiting', 'ready', 'leased', 'reply_saved', 'completed', 'cancelled', 'unknown']) || !nullable(v.nextJobId, x => workId(x, 'job')) || v.nextJobId === v.jobId || !nullable(v.nextAttemptAt, workTime) || !nullable(v.outboxId, workUuid)) return false;
  if (!oneOf(v.outputKind, ['none', 'generated', 'catalog', 'audio_fallback']) || (v.outboxId === null) !== (v.outputKind === 'none') || v.generationState === 'unknown' && v.outboxId !== null) return false;
  if (v.authorityKind === 'fixed_notice' && (v.audioState !== 'not_applicable' || v.generationState !== 'not_applicable' || v.kind !== 'control')) return false;
  if (v.sourceKind !== 'audio' && v.audioState !== 'not_applicable') return false;
  if (v.authorityKind === 'actor' && v.catalogId !== null && !['support_ready', 'plans_ready', 'audio_fallback'].includes(String(v.catalogId))) return false;
  if (v.outputKind === 'generated' && (v.catalogId !== null || v.generationState !== 'completed') || v.outputKind === 'audio_fallback' && (v.catalogId !== 'audio_fallback' || !['failed', 'unknown'].includes(String(v.audioState))) || v.outputKind === 'catalog' && v.catalogId === null) return false;
  if (![v.leaseClaimedAt, v.leaseExpiresAt, v.processingStartedAt, v.processingDeadlineAt].every(x => nullable(x, workTime)) || !nullable(v.leaseToken, workUuid)) return false;
  if (v.processingStartedAt === null ? v.processingDeadlineAt !== null : v.processingDeadlineAt !== Math.min(Number(v.processingStartedAt) + WORK_DEADLINE_MS, Number(v.bodyExpiresAt), v.windowExpiresAt === null ? 0 : Number(v.windowExpiresAt))) return false;
  if (v.leaseToken === null ? v.leaseClaimedAt !== null || v.leaseExpiresAt !== null : !workTime(v.leaseClaimedAt) || !workTime(v.leaseExpiresAt) || v.leaseExpiresAt > v.leaseClaimedAt + WORK_LEASE_MS || !workTime(v.processingDeadlineAt) || v.leaseExpiresAt > v.processingDeadlineAt) return false;
  return v.status === 'leased' ? v.leaseToken !== null && v.nextAttemptAt === v.leaseExpiresAt : v.status === 'reply_saved' ? v.outboxId !== null && workTime(v.nextAttemptAt) : ['cancelled', 'completed', 'unknown', 'waiting'].includes(String(v.status)) ? v.nextAttemptAt === null : v.leaseToken === null && workTime(v.nextAttemptAt);
}
export function isPlatformOutbox(v: unknown): v is PlatformOutbox {
  if (!identity(v) || !workExact(v, [...sourceKeys, ...authorityKeys(v), 'recordType', 'outboxId', 'outputFingerprint', 'outputKind', 'menuPurpose', 'menuVersion', 'menuActions', 'consumedByEventId', 'consumedAt', 'status', 'sendToken', 'sendClaimedAt', 'sendStartedAt', 'sendFinishedAt', 'providerId', 'sendReservationId', ...Object.hasOwn(v, 'deliveryStatus') ? ['deliveryStatus', 'deliveryFailed', 'deliveryObservedAt'] : []]) || v.recordType !== 'outbox' || !source(v) || !workUuid(v.outboxId) || !workDigest(v.outputFingerprint)) return false;
  if (Object.hasOwn(v, 'deliveryStatus') && (!oneOf(v.deliveryStatus, ['unobserved', 'accepted', 'sent', 'delivered', 'read']) || typeof v.deliveryFailed !== 'boolean' || !nullable(v.deliveryObservedAt, workTime) || v.deliveryStatus === 'unobserved' && !v.deliveryFailed && v.deliveryObservedAt !== null || (v.deliveryStatus !== 'unobserved' || v.deliveryFailed) && v.deliveryObservedAt === null)) return false;
  if (!oneOf(v.outputKind, ['generated', 'catalog', 'audio_fallback']) || (v.outputKind === 'generated') !== (v.catalogId === null) || v.outputKind === 'audio_fallback' && v.catalogId !== 'audio_fallback' || !oneOf(v.menuPurpose, ['notice', 'support', 'admin', 'reply']) || v.menuVersion !== 1) return false;
  if (v.catalogId !== null && v.menuPurpose !== workCatalog[v.catalogId as CatalogId].purpose) return false;
  const actions = createPlatformMenu(v.outboxId, v.menuPurpose as PlatformOutbox['menuPurpose']).map(b => parsePlatformMenuChoice(b.id)!.action);
  if (JSON.stringify(v.menuActions) !== JSON.stringify(actions) || !nullable(v.consumedByEventId, x => workId(x, 'event')) || !nullable(v.consumedAt, workTime) || (v.consumedAt === null) !== (v.consumedByEventId === null) || v.consumedAt !== null && v.status !== 'accepted') return false;
  if (!nullable(v.sendToken, workUuid) || !nullable(v.sendReservationId, x => workId(x, 'call')) || !['sendClaimedAt', 'sendStartedAt', 'sendFinishedAt'].every(k => nullable(v[k], workTime)) || !nullable(v.providerId, x => workText(x, 'provider'))) return false;
  if (v.status === 'prepared') return ['sendToken', 'sendReservationId', 'sendClaimedAt', 'sendStartedAt', 'sendFinishedAt', 'providerId'].every(k => v[k] === null);
  if (v.status === 'cancelled') return workTime(v.sendFinishedAt) && (v.sendToken === null ? v.sendReservationId === null && v.sendClaimedAt === null && v.sendStartedAt === null : v.sendReservationId !== null && workTime(v.sendClaimedAt));
  if (v.sendToken === null || v.sendReservationId === null || !workTime(v.sendClaimedAt)) return false;
  if (v.status === 'claimed') return v.sendStartedAt === null && v.sendFinishedAt === null && v.providerId === null;
  if (!workTime(v.sendStartedAt) || v.sendStartedAt < v.sendClaimedAt) return false;
  return v.status === 'started' ? v.sendFinishedAt === null && v.providerId === null : oneOf(v.status, ['accepted', 'rejected', 'unknown']) && workTime(v.sendFinishedAt) && v.sendFinishedAt >= v.sendStartedAt && (v.status === 'accepted' ? v.providerId !== null : v.providerId === null);
}
export function outboxMatchesJob(o: PlatformOutbox, j: PlatformJob): boolean {
  const fields = [...identityKeys, 'jobId', 'epoch', 'sourceEventId', 'conversationId', 'controlEpoch', 'controlRevision', 'connectionRevision', 'conversationRevision', 'sourceOccurredAt', 'sourceReceivedAt', 'customerSentAt', 'windowExpiresAt', 'bodyExpiresAt', 'expiresAt', 'requestFingerprint', 'outputKind', 'catalogId', 'catalogVersion', ...authorityKeys(j as unknown as R)];
  return j.outboxId === o.outboxId && fields.every(k => (o as unknown as R)[k] === (j as unknown as R)[k]);
}
export function validUsage(v: Usage, stage: CostStage): boolean {
  return workObject(v) && workExact(v, usageKeys) && usageKeys.every(k => nullable(v[k as keyof Usage], workInteger)) && (stage === 'audio' ? v.usageInputTokens === null && v.usageOutputTokens === null && v.usageMessages === null && (v.usageAudioMilliseconds === null || v.usageAudioMilliseconds <= 120_000)
    : stage === 'generation' ? v.usageAudioMilliseconds === null && v.usageMessages === null && (v.usageInputTokens === null) === (v.usageOutputTokens === null) : v.usageAudioMilliseconds === null && v.usageInputTokens === null && v.usageOutputTokens === null && (v.usageMessages === null || v.usageMessages === 1));
}
export function isBudgetCall(v: unknown): v is BudgetCall {
  if (!identity(v) || !workExact(v, [...identityKeys, ...usageKeys, 'recordType', 'reservationId', 'jobId', 'epoch', 'stage', 'requestFingerprint', 'maximumMicros', 'actualMicros', 'tariffVersion', 'policyFingerprint', 'periodId', 'circuitId', 'createdAt', 'expiresAt', 'status', 'effectToken', 'startedAt', 'finishedAt', ...Object.hasOwn(v, 'quote') ? ['quote'] : []]) || v.recordType !== 'budget_call' || Object.hasOwn(v, 'quote') && (v.stage !== 'generation' || !isGenerationQuote(v.quote) || v.maximumMicros !== v.quote.maximumMicros)) return false;
  if (!workId(v.reservationId, 'call') || !workId(v.jobId, 'job') || !workUuid(v.epoch) || !oneOf(v.stage, ['audio', 'generation', 'send']) || !workDigest(v.requestFingerprint) || !workInteger(v.maximumMicros) || !nullable(v.actualMicros, workInteger) || !identifier(v.tariffVersion) || !workDigest(v.policyFingerprint) || !workId(v.periodId, 'day') || !workId(v.circuitId, 'circuit') || !workTime(v.createdAt) || !workTime(v.expiresAt) || v.expiresAt <= v.createdAt || v.expiresAt > v.createdAt + PLATFORM_METADATA_TTL || !validUsage(Object.fromEntries(usageKeys.map(k => [k, v[k]])) as Usage, v.stage as CostStage) || !nullable(v.effectToken, workUuid) || !nullable(v.startedAt, workTime) || !nullable(v.finishedAt, workTime)) return false;
  const noUsage = usageKeys.every(k => v[k] === null);
  if (v.status === 'reserved') return v.actualMicros === null && v.effectToken === null && v.startedAt === null && v.finishedAt === null && noUsage;
  if (v.status === 'released') return v.actualMicros === 0 && v.effectToken === null && v.startedAt === null && workTime(v.finishedAt) && noUsage;
  if (v.effectToken === null || !workTime(v.startedAt)) return false;
  return v.status === 'started' ? v.actualMicros === null && v.finishedAt === null && noUsage : v.status === 'uncertain' ? v.actualMicros === null && workTime(v.finishedAt) && noUsage : v.status === 'settled' && workInteger(v.actualMicros) && workTime(v.finishedAt);
}
export function isBudgetPeriod(v: unknown): v is BudgetPeriod {
  return identity(v) && workExact(v, [...identityKeys, ...usageKeys, 'recordType', 'periodId', 'stage', 'dayStart', 'dayEnd', 'usedMicros', 'heldMicros', 'overrunMicros', 'expiresAt']) && v.recordType === 'budget_period' && workId(v.periodId, 'day') && oneOf(v.stage, ['audio', 'generation', 'send'])
    && workTime(v.dayStart) && v.dayStart % PLATFORM_BODY_TTL === 0 && workTime(v.dayEnd) && v.dayEnd === v.dayStart + PLATFORM_BODY_TTL && workTime(v.expiresAt) && v.expiresAt === v.dayStart + PLATFORM_METADATA_TTL
    && ['usedMicros', 'heldMicros', 'overrunMicros'].every(k => workInteger(v[k])) && usageKeys.every(k => nullable(v[k], workInteger))
    && Number.isSafeInteger(Number(v.usedMicros) + Number(v.heldMicros)) && Number(v.overrunMicros) <= Number(v.usedMicros)
    && (v.stage === 'audio' ? v.usageInputTokens === null && v.usageOutputTokens === null && v.usageMessages === null : v.stage === 'generation' ? v.usageAudioMilliseconds === null && v.usageMessages === null : v.usageAudioMilliseconds === null && v.usageInputTokens === null && v.usageOutputTokens === null);
}
export function isBudgetCircuit(v: unknown): v is BudgetCircuit {
  return identity(v) && workExact(v, [...identityKeys, 'recordType', 'circuitId', 'stage', 'status', 'policyFingerprint', 'createdAt', 'expiresAt', 'trippedAt', 'reason']) && v.recordType === 'budget_circuit' && workId(v.circuitId, 'circuit') && oneOf(v.stage, ['audio', 'generation', 'send']) && workDigest(v.policyFingerprint)
    && workTime(v.createdAt) && workTime(v.expiresAt) && v.expiresAt === v.createdAt + PLATFORM_METADATA_TTL && (v.status === 'open' ? v.trippedAt === null && v.reason === null : v.status === 'blocked' && workTime(v.trippedAt) && v.trippedAt >= v.createdAt && oneOf(v.reason, ['overrun', 'accounting_invalid']));
}
export function isContactRate(v: unknown): v is ContactRate {
  return identity(v) && workExact(v, [...identityKeys, 'recordType', 'conversationId', 'acceptedAt', 'expiresAt']) && v.recordType === 'contact_rate' && workDigest(v.conversationId) && Array.isArray(v.acceptedAt) && v.acceptedAt.length > 0 && v.acceptedAt.length <= 50 && v.acceptedAt.every((t, i, all) => workTime(t) && (i === 0 || t >= all[i - 1])) && workTime(v.expiresAt) && v.expiresAt === Number(v.acceptedAt.at(-1)) + PLATFORM_BODY_TTL;
}
export function isProviderAlias(v: unknown): v is ProviderAlias {
  return identity(v) && workExact(v, [...identityKeys, 'recordType', 'providerId', 'outboxId', 'jobId', 'epoch', 'expiresAt']) && v.recordType === 'provider_alias' && workText(v.providerId, 'provider') && workUuid(v.outboxId) && workId(v.jobId, 'job') && workUuid(v.epoch) && workTime(v.expiresAt);
}
export function isWorkRecordAtPath(path: string, v: unknown): v is WorkRecord {
  return isProviderAlias(v) ? /^platformWhatsAppOutbox\/provider_[a-f0-9]{64}$/.test(path) : isControlHead(v) ? path === 'platformWhatsAppJobs/head_' + v.conversationId
    : isPlatformJob(v) ? path === 'platformWhatsAppJobs/' + v.jobId : isPlatformOutbox(v) ? path === 'platformWhatsAppOutbox/' + v.outboxId
    : isBudgetCall(v) ? path === 'platformWhatsAppBudgetCalls/' + v.reservationId : isBudgetPeriod(v) ? path === 'platformWhatsAppBudgetPeriods/' + v.periodId
    : isBudgetCircuit(v) ? path === 'platformWhatsAppBudgetPeriods/' + v.circuitId : isContactRate(v) && path === 'platformWhatsAppBudgetPeriods/rate_' + v.conversationId;
}
