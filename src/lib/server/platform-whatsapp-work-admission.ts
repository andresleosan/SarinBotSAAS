import 'server-only';
import { isSuperadmin } from './auth';
import { randomUUID } from 'node:crypto';
import type { Database, Transaction } from '@/lib/storage/types';
import { PLATFORM_METADATA_TTL, type PlatformWhatsAppConnectionRecord, type PlatformWhatsAppConversationRecord, type PlatformWhatsAppEventRecord, type PlatformWhatsAppScope } from '../../../shared/platform-whatsapp-records';
import { workCatalog, workText, outboxMatchesJob, type CatalogId, type ControlHead, type PlatformJob, type ContactRate, type PlatformOutbox } from '../../../shared/platform-whatsapp-work';
import { parsePlatformMenuChoice } from '../../../shared/platform-whatsapp-menu';
import { maximumPlatformCost } from '../../../shared/platform-whatsapp-policy';
import { encryptPlatformWhatsAppContent } from './platform-whatsapp-crypto';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { actorAuthority, authorityFingerprint, freshWorkConnection, sameWorkAuthority, workPayload } from './platform-whatsapp-work-authority';
import { preparePlatformWhatsAppAudioRetentionIdentity, readPlatformWhatsAppAudioRetentionIdentityInTransaction, type AudioRetentionIdentity } from './platform-whatsapp-link';
import { readWork, stageWork, workHash, checkedAdd } from './platform-whatsapp-work-records';
import { platformWhatsAppIdentity, platformWhatsAppUnavailableError, samePlatformWhatsAppScope } from './platform-whatsapp-store';
import { currentPlatformWorkPolicy, readPlatformReservation } from './platform-whatsapp-budget';
import { readWorkCancellation, stageWorkCancellation } from './platform-whatsapp-work-cancellation';
import { HttpError } from './http';

type Incoming = { kind: 'incoming_text' | 'incoming_audio' | 'incoming_choice' | 'human_echo'; customerPhone: string; text?: string | null; choiceId?: string };
/** UUIDs and every candidate envelope are allocated before the supplied transaction. */
export async function prepareWorkAdmission(event: Incoming, scope: PlatformWhatsAppScope, eventId: string, db: Database, now: number) {
  const identity = event.kind !== 'human_echo' ? await preparePlatformWhatsAppAudioRetentionIdentity(event.customerPhone, scope, db, now) : null;
  const key = getPlatformWhatsAppConfig().contentKey;
  const jobs = Object.fromEntries((['control', 'customer_reply', 'admin_query'] as const).map(kind => {
    const jobId = 'job_' + workHash('work', [scope.wabaId, scope.phoneE164, scope.phoneNumberId], eventId, kind);
    return [kind, { jobId, epoch: randomUUID(), notice: encryptPlatformWhatsAppContent({ customerPhone: event.customerPhone }, 'platformWhatsAppJobs/' + jobId, key), actor: encryptPlatformWhatsAppContent({ customerPhone: event.customerPhone, question: kind !== 'control' && event.kind === 'incoming_text' ? event.text : kind === 'admin_query' && event.kind === 'incoming_choice' ? ({ payments: 'Consulta los pagos pendientes.', status: 'Consulta el estado verificable de SarinBot.', inbox: 'Consulta el soporte recibido.' } as Record<string, string>)[parsePlatformMenuChoice(event.choiceId)?.action ?? ''] ?? null : null }, 'platformWhatsAppJobs/' + jobId, key) }];
  })) as Record<'control' | 'customer_reply' | 'admin_query', { jobId: string; epoch: string; notice: PlatformJob['content']; actor: PlatformJob['content'] }>;
  return { identity, jobs, headEpoch: randomUUID() };
}
type Admission = Awaited<ReturnType<typeof prepareWorkAdmission>>;
function jobFor(source: PlatformWhatsAppEventRecord, sourceEventId: string, head: ControlHead, kind: 'control' | 'customer_reply' | 'admin_query', catalogId: CatalogId | null, actor: AudioRetentionIdentity | null, prepared: Admission, now: number): PlatformJob {
  const template = prepared.jobs[kind];
  return { ...platformWhatsAppIdentity(source), recordType: 'job', jobId: template.jobId, epoch: template.epoch, sourceEventId, sourceKind: source.kind === 'incoming_audio' ? 'audio' : source.kind === 'incoming_choice' ? 'menu' : 'text', kind, requestFingerprint: source.fingerprint, conversationId: source.conversationId, controlEpoch: head.controlEpoch, controlRevision: head.controlRevision, connectionRevision: source.connectionRevision, conversationRevision: head.attachedConversationRevision,
    sourceOccurredAt: source.occurredAt, sourceReceivedAt: source.receivedAt, createdAt: now, customerSentAt: 'customerSentAt' in source ? source.customerSentAt ?? null : null, windowExpiresAt: 'customerSentAt' in source && source.customerSentAt !== null && source.customerSentAt !== undefined ? source.customerSentAt + 86_400_000 : null, bodyExpiresAt: source.bodyExpiresAt, expiresAt: source.expiresAt,
    status: head.headJobId ? 'waiting' : 'ready', nextJobId: null, nextAttemptAt: head.headJobId ? null : now, leaseToken: null, leaseClaimedAt: null, leaseExpiresAt: null, processingStartedAt: null, processingDeadlineAt: null, outboxId: null, outputKind: 'none', catalogId, catalogVersion: catalogId ? 1 : null, bodyState: 'body_present', content: actor ? template.actor : template.notice,
    ...actor ? actorAuthority(actor) : { authorityKind: 'fixed_notice' as const, noticeId: catalogId!, noticeVersion: 1 as const },
    audioState: actor && kind !== 'control' && !catalogId && source.kind === 'incoming_audio' ? 'not_started' : 'not_applicable', audioToken: null, audioLeaseToken: null, audioReservationId: null, audioStartedAt: null, audioFinishedAt: null,
    generationState: actor && kind !== 'control' && !catalogId ? 'not_started' : 'not_applicable', generationToken: null, generationLeaseToken: null, generationReservationId: null, generationStartedAt: null, generationFinishedAt: null };
}
function validMenu(o: PlatformOutbox, h: ControlHead, source: PlatformWhatsAppEventRecord, action: string, now: number) {
  return o.status === 'accepted' && o.consumedAt === null && o.consumedByEventId === null && h.currentMenuOutboxId === o.outboxId && o.menuActions.includes(action) && o.menuVersion === 1 && o.conversationId === source.conversationId && samePlatformWhatsAppScope(o, source) && o.controlEpoch === h.controlEpoch && o.controlRevision === h.controlRevision && o.connectionRevision === h.connectionRevision && o.conversationRevision === h.attachedConversationRevision && o.expiresAt > now && o.bodyExpiresAt > now && o.windowExpiresAt !== null && o.windowExpiresAt > now;
}
/** Returns write-only staging plus the exact source/conversation projection. */
export async function readWorkAdmission(event: Incoming, eventId: string, source: PlatformWhatsAppEventRecord, oldConversation: PlatformWhatsAppConversationRecord | null, updatedConversation: PlatformWhatsAppConversationRecord | null, connection: PlatformWhatsAppConnectionRecord, prepared: Admission, tx: Transaction, db: Database, now: number) {
  const prior = await readWork(tx, db, 'platformWhatsAppJobs/head_' + source.conversationId);
  if (prior && (prior.recordType !== 'control_head' || !samePlatformWhatsAppScope(prior, source))) throw platformWhatsAppUnavailableError();
  const existing = prior?.recordType === 'control_head' && prior.expiresAt > now ? prior : null;
  let head: ControlHead = existing ?? { ...platformWhatsAppIdentity(source), recordType: 'control_head', conversationId: source.conversationId, controlEpoch: prepared.headEpoch, controlRevision: 0, connectionRevision: connection.connectionRevision, entryState: oldConversation ? 'human_paused' : 'initial', botAuthorityFingerprint: null, attachedConversationRevision: oldConversation?.revision ?? updatedConversation?.revision ?? null, headJobId: null, tailJobId: null, currentMenuOutboxId: null, status: 'idle', nextAttemptAt: null, receivedAt: now, expiresAt: now + PLATFORM_METADATA_TTL };
  const cancellation = await readWorkCancellation(source.conversationId, source, tx, db);
  let conversation = updatedConversation, record = source, consumed: PlatformOutbox | null = null, reduction = event.kind === 'human_echo' || event.kind === 'incoming_text' && event.text === 'SALIR';
  let catalog: CatalogId | null = null, actor: AudioRetentionIdentity | null = null, kind: 'control' | 'customer_reply' | 'admin_query' = 'control', entering = false;
  const parsed = event.kind === 'incoming_choice' ? parsePlatformMenuChoice(event.choiceId) : null;
  if (parsed && existing && existing.connectionRevision === connection.connectionRevision && freshWorkConnection(connection, now)) {
    const outbox = await readWork(tx, db, 'platformWhatsAppOutbox/' + parsed.outboxId);
    if (outbox?.recordType === 'outbox' && validMenu(outbox, head, source, parsed.action, now) && workPayload(outbox, now)?.customerPhone === event.customerPhone) {
      const parent = await readWork(tx, db, 'platformWhatsAppJobs/' + outbox.jobId), original = (await tx.get(db.collection('platformWhatsAppEvents').doc(outbox.sourceEventId))).data();
      if (parent?.recordType !== 'job' || !outboxMatchesJob(outbox, parent) || !original || original.fingerprint !== outbox.requestFingerprint || original.conversationId !== source.conversationId || original.expiresAt !== outbox.expiresAt) throw platformWhatsAppUnavailableError();
      if (head.entryState === 'bot' && outbox.menuPurpose === 'admin' && ['payments', 'status', 'inbox'].includes(parsed.action)) {
        const verified = prepared.identity && isSuperadmin(prepared.identity.uid) ? await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared.identity, event.customerPhone, source, tx, db, now) : null;
        if (verified && outbox.authorityKind === 'actor' && sameWorkAuthority(outbox, actorAuthority(verified)) && authorityFingerprint(actorAuthority(verified)) === head.botAuthorityFingerprint) { actor = verified; kind = 'admin_query'; consumed = outbox; }
      } else if (['human', 'stop'].includes(parsed.action)) { consumed = outbox; reduction = true; }
      else if (head.entryState === 'initial' && parsed.action === 'accept' && outbox.menuPurpose === 'notice') { consumed = outbox; catalog = 'support_menu'; }
      else if (head.entryState === 'initial' && ['support', 'plans'].includes(parsed.action) && outbox.menuPurpose === 'support') {
        const verified = prepared.identity?.conversationId === source.conversationId ? await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared.identity, event.customerPhone, source, tx, db, now) : null;
        if (verified && (outbox.authorityKind === 'fixed_notice' || sameWorkAuthority(outbox, actorAuthority(verified)))) { actor = verified; kind = isSuperadmin(verified.uid) ? 'admin_query' : 'control'; catalog = kind === 'admin_query' ? 'admin_menu' : parsed.action === 'support' ? 'support_ready' : 'plans_ready'; entering = true; }
        else catalog = 'permission';
        consumed = outbox;
      }
    }
  }
  if (reduction) {
    if (conversation) conversation = { ...conversation, mode: 'human', revision: checkedAdd(conversation.revision, 1) };
    if (cancellation) head = { ...head, controlRevision: checkedAdd(head.controlRevision, 1) };
    head = { ...head, entryState: 'human_paused', botAuthorityFingerprint: null, attachedConversationRevision: conversation?.revision ?? null, headJobId: null, tailJobId: null, currentMenuOutboxId: null, status: 'idle', nextAttemptAt: null };
  } else if (event.kind !== 'incoming_choice' && head.entryState === 'initial' && head.headJobId === null) catalog = event.kind === 'incoming_audio' ? 'identification_audio' : 'identification';
  else if (event.kind !== 'incoming_choice' && head.entryState === 'bot' && event.kind !== 'human_echo') {
    const verified = prepared.identity?.conversationId === source.conversationId ? await readPlatformWhatsAppAudioRetentionIdentityInTransaction(prepared.identity, event.customerPhone, source, tx, db, now) : null;
    if (verified && authorityFingerprint(actorAuthority(verified)) === head.botAuthorityFingerprint && (event.kind !== 'incoming_text' || workText(event.text, 'question')) && (event.kind !== 'incoming_audio' || source.kind === 'incoming_audio' && source.ingressDisposition === 'descriptor_retained')) { actor = verified; kind = isSuperadmin(verified.uid) ? 'admin_query' : 'customer_reply'; }
  }
  if (entering && actor) {
    // A signed choice creates an ordinary conversation only after exact current identity.
    conversation = { ...(conversation ?? { ...platformWhatsAppIdentity(source), recordType: 'conversation' as const, state: 'body_erased' as const, contactContent: null, mode: 'human' as const, revision: 0, updatedAt: now, lastInboundAt: source.occurredAt, lastHumanAt: null, previewOccurredAt: source.occurredAt, previewReceivedAt: source.receivedAt, bodyExpiresAt: source.bodyExpiresAt, expiresAt: source.expiresAt, canonicalIdentity: source.canonicalIdentity, conflictAt: null }), mode: 'bot', revision: checkedAdd(conversation?.revision ?? 0, 1) };
    head = { ...head, entryState: 'bot', botAuthorityFingerprint: authorityFingerprint(actorAuthority(actor)), attachedConversationRevision: conversation.revision, controlRevision: checkedAdd(head.controlRevision, 1), headJobId: null, tailJobId: null, status: 'idle', nextAttemptAt: null, currentMenuOutboxId: null };
  }
  if (consumed) head = { ...head, currentMenuOutboxId: null };
  head = { ...head, receivedAt: now, expiresAt: now + PLATFORM_METADATA_TTL, attachedConversationRevision: conversation?.revision ?? head.attachedConversationRevision };
  let job: PlatformJob | null = !reduction && (catalog || actor) && head.connectionRevision === connection.connectionRevision && head.entryState !== 'human_paused' && freshWorkConnection(connection, now) ? jobFor(source, eventId, head, kind, catalog, actor, prepared, now) : null;
  let rate: ContactRate | null = null, tail: PlatformJob | null = null;
  if (job) {
    if (job.windowExpiresAt === null || job.windowExpiresAt <= now || job.bodyExpiresAt <= now) job = null;
    else {
      const r = await readWork(tx, db, 'platformWhatsAppBudgetPeriods/rate_' + source.conversationId);
      if (r && r.recordType !== 'contact_rate') throw platformWhatsAppUnavailableError();
      const acceptedAt = r?.recordType === 'contact_rate' ? r.acceptedAt.filter(t => t > now - 86_400_000) : [];
      if (acceptedAt.some(t => t > now)) throw platformWhatsAppUnavailableError();
      if (acceptedAt.length >= 50 || acceptedAt.filter(t => t > now - 60_000).length >= 10) job = null;
      if (job) {
        try { const p = currentPlatformWorkPolicy(), stage = catalog ? 'send' : source.kind === 'incoming_audio' ? 'audio' : 'generation'; await readPlatformReservation(job, stage, maximumPlatformCost(p.policy, stage), tx, db, now); }
        catch (e) { if (e instanceof HttpError && e.code === 'PLATFORM_WORK_CLOSED') job = null; else throw e; }
      }
      if (job) rate = { ...platformWhatsAppIdentity(source), recordType: 'contact_rate', conversationId: source.conversationId, acceptedAt: [...acceptedAt, now], expiresAt: now + 86_400_000 };
    }
    if (job && head.tailJobId) { const t = await readWork(tx, db, 'platformWhatsAppJobs/' + head.tailJobId); if (t?.recordType !== 'job' || t.nextJobId !== null || t.controlEpoch !== head.controlEpoch || t.controlRevision !== head.controlRevision || t.conversationId !== head.conversationId || head.status === 'repair_needed') throw platformWhatsAppUnavailableError(); tail = t; }
  }
  if (consumed) record = { ...source, kind: 'incoming_choice', ingressDisposition: 'choice_consumed', state: 'body_erased', content: null, consumedOutboxId: consumed.outboxId, consumedAction: parsed!.action, resultControlEpoch: head.controlEpoch, resultControlRevision: head.controlRevision, resultJobId: job?.jobId ?? null } as PlatformWhatsAppEventRecord;
  return { record, conversation, stage() {
    if (reduction || entering) stageWorkCancellation(cancellation, conversation?.revision ?? null, tx, db, now);
    if (consumed) stageWork(tx, db, 'platformWhatsAppOutbox/' + consumed.outboxId, { ...consumed, consumedAt: now, consumedByEventId: eventId });
    if (job && rate) {
      if (tail) stageWork(tx, db, 'platformWhatsAppJobs/' + tail.jobId, { ...tail, nextJobId: job.jobId });
      stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, job); stageWork(tx, db, 'platformWhatsAppBudgetPeriods/rate_' + source.conversationId, rate);
      head = { ...head, headJobId: head.headJobId ?? job.jobId, tailJobId: job.jobId, status: head.status === 'advance' ? 'advance' : 'active' };
    }
    // Choice denial cannot bootstrap controls or effects.
    if (event.kind !== 'incoming_choice' || consumed) stageWork(tx, db, 'platformWhatsAppJobs/head_' + source.conversationId, head);
  } };
}
