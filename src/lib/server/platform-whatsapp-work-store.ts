import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Database, Transaction } from '@/lib/storage/types';
import { isPlatformWhatsAppConversationRecord } from '../../../shared/platform-whatsapp-records';
import { createPlatformMenu, parsePlatformMenuChoice } from '../../../shared/platform-whatsapp-menu';
import { WORK_DEADLINE_MS, WORK_LEASE_MS, workCatalog, workText, emptyUsage, outboxMatchesJob, type DeliveryResult, type Lease, type PlatformJob, type PlatformOutbox, type Usage } from '../../../shared/platform-whatsapp-work';
import { maximumPlatformCost } from '../../../shared/platform-whatsapp-policy';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { encryptPlatformWhatsAppContent, platformWhatsAppDigest } from './platform-whatsapp-crypto';
import { platformWhatsAppConflictError, platformWhatsAppUnavailableError } from './platform-whatsapp-store';
import { readWork, stageWork, checkedAdd } from './platform-whatsapp-work-records';
import { prepareWorkIdentity, readWorkAuthority, workPayload, workActor } from './platform-whatsapp-work-authority';
import { currentPlatformWorkPolicy, readPlatformReservation, stagePlatformReservation, stagePlatformCostStart, readPlatformSettlement, stagePlatformSettlement } from './platform-whatsapp-budget';
import { dueWork, prepareHeadAdvance } from './platform-whatsapp-work-queue';
import { readWorkCancellation, stageWorkCancellation } from './platform-whatsapp-work-cancellation';

const liveLease = (job: PlatformJob, lease: Lease, now: number) => job.jobId === lease.jobId && job.epoch === lease.epoch && job.leaseToken === lease.token && job.leaseExpiresAt !== null && now < job.leaseExpiresAt && job.processingDeadlineAt !== null && now < job.processingDeadlineAt && ['leased', 'reply_saved'].includes(job.status);
export async function preparedLease(lease: Lease, db: Database, now: number) {
  const job = await db.runTransaction(tx => readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId));
  if (job?.recordType !== 'job' || !liveLease(job, lease, now)) return null;
  const prepared = await prepareWorkIdentity(job, db, now); return prepared ? { job, prepared } : null;
}
function outboxFingerprint(job: PlatformJob, text: string, purpose: PlatformOutbox['menuPurpose'], actions: string[]) {
  return platformWhatsAppDigest('work-output', [JSON.stringify([job.wabaId, job.phoneE164, job.phoneNumberId, job.jobId, job.epoch, job.outputKind === 'none' ? job.catalogId === 'audio_fallback' ? 'audio_fallback' : job.catalogId ? 'catalog' : 'generated' : job.outputKind, job.catalogId, job.catalogVersion, purpose, 1, actions, text])], getPlatformWhatsAppConfig().contentKey);
}
export function prepareOutbox(job: PlatformJob, customerPhone: string, text: string, id: string, now: number): PlatformOutbox {
  if (!workText(text, 'reply')) throw platformWhatsAppConflictError();
  const purpose = job.catalogId ? workCatalog[job.catalogId].purpose : 'reply', actions = createPlatformMenu(id, purpose).map(b => parsePlatformMenuChoice(b.id)!.action);
  const { recordType: _rt, sourceKind: _sk, kind: _k, status: _s, nextJobId: _next, nextAttemptAt: _at, leaseToken: _lt, leaseClaimedAt: _lc, leaseExpiresAt: _le, processingStartedAt: _ps, processingDeadlineAt: _pd,
    audioState: _as, audioToken: _at2, audioLeaseToken: _alt, audioReservationId: _ar, audioStartedAt: _ast, audioFinishedAt: _af,
    generationState: _gs, generationToken: _gt, generationLeaseToken: _glt, generationReservationId: _gr, generationStartedAt: _gst, generationFinishedAt: _gf, outboxId: _oid, outputKind: _ok, ...common } = job;
  return { ...common, createdAt: now, recordType: 'outbox', outboxId: id, outputFingerprint: outboxFingerprint(job, text, purpose, actions), outputKind: job.catalogId === 'audio_fallback' ? 'audio_fallback' : job.catalogId ? 'catalog' : 'generated', menuPurpose: purpose, menuVersion: 1, menuActions: actions, consumedByEventId: null, consumedAt: null, status: 'prepared', sendToken: null, sendClaimedAt: null, sendStartedAt: null, sendFinishedAt: null, providerId: null, sendReservationId: null, bodyState: 'body_present', content: encryptPlatformWhatsAppContent({ customerPhone, text }, 'platformWhatsAppOutbox/' + id, getPlatformWhatsAppConfig().contentKey) };
}
export function stageReply(job: PlatformJob, outbox: PlatformOutbox, tx: Transaction, db: Database) {
  stageWork(tx, db, 'platformWhatsAppOutbox/' + outbox.outboxId, outbox);
  stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, { ...job, status: 'reply_saved', nextAttemptAt: job.processingDeadlineAt, outboxId: outbox.outboxId, outputKind: outbox.outputKind });
}
async function readOutboxPreparation(id: string, db: Database, now: number) {
  const outbox = await db.runTransaction(tx => readWork(tx, db, 'platformWhatsAppOutbox/' + id));
  if (outbox?.recordType !== 'outbox') return null;
  const job = await db.runTransaction(tx => readWork(tx, db, 'platformWhatsAppJobs/' + outbox.jobId));
  if (job?.recordType !== 'job' || job.outboxId !== id || job.epoch !== outbox.epoch) throw platformWhatsAppUnavailableError();
  if (!outboxMatchesJob(outbox, job)) throw platformWhatsAppUnavailableError();
  const payload = workPayload(outbox, now);
  if (payload && outbox.outputFingerprint !== outboxFingerprint(job, payload.text!, outbox.menuPurpose, outbox.menuActions)) throw platformWhatsAppUnavailableError();
  const prepared = await prepareWorkIdentity(job, db, now); return prepared ? { job, outbox, prepared } : null;
}
export function createPlatformWorkStore(db: Database, clock: () => number = Date.now) {
  return {
    async claimNext(): Promise<Lease | null> {
      const now = clock(), token = randomUUID();
      for (const status of ['advance', 'leased', 'reply_saved', 'ready']) {
        const candidates = await dueWork(db, status, now).get();
        for (const candidate of candidates.docs) {
          const row = await db.runTransaction(tx => readWork(tx, db, 'platformWhatsAppJobs/' + candidate.id));
          if (row?.recordType === 'control_head' && row.status === 'advance') {
            await db.runTransaction(async tx => { const h = await readWork(tx, db, 'platformWhatsAppJobs/' + candidate.id); if (h?.recordType === 'control_head' && h.status === 'advance') { const apply = await prepareHeadAdvance(h, null, tx, db, now); apply(); } }); continue;
          }
          if (row?.recordType !== 'job') continue;
          const prepared = await prepareWorkIdentity(row, db, now);
          const lease = await db.runTransaction(async tx => {
            const job = await readWork(tx, db, 'platformWhatsAppJobs/' + row.jobId);
            if (job?.recordType !== 'job' || !['ready', 'leased', 'reply_saved'].includes(job.status) || job.nextAttemptAt === null || job.nextAttemptAt > now) return null;
            const authority = prepared ? await readWorkAuthority(job, prepared, tx, db, now) : null;
            const head = authority?.head ?? await readWork(tx, db, 'platformWhatsAppJobs/head_' + job.conversationId);
            const consumed = job.outboxId !== null || [job.audioState, job.generationState].some(s => !['not_applicable', 'not_started', 'completed'].includes(s));
            const deadline = job.processingDeadlineAt ?? Math.min(now + WORK_DEADLINE_MS, job.bodyExpiresAt, job.windowExpiresAt ?? 0);
            if (authority && now < deadline && job.authorityKind === 'actor' && job.sourceKind === 'audio' && job.outboxId === null && job.generationState === 'not_started' && ['preparing', 'started', 'result_pending', 'failed', 'unknown'].includes(job.audioState)) {
              const policy = currentPlatformWorkPolicy(); await readPlatformReservation(job, 'send', maximumPlatformCost(policy.policy, 'send'), tx, db, now);
              const expiry = Math.min(now + WORK_LEASE_MS, deadline);
              stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, { ...job, status: 'leased', leaseToken: token, leaseClaimedAt: now, leaseExpiresAt: expiry, nextAttemptAt: expiry, audioState: job.audioState === 'failed' ? 'failed' : 'unknown', audioFinishedAt: job.audioFinishedAt ?? now, generationState: 'not_applicable', catalogId: 'audio_fallback', catalogVersion: 1 });
              return { jobId: job.jobId, epoch: job.epoch, token };
            }
            if (!authority || now >= deadline || consumed) {
              const outbox = job.outboxId ? await readWork(tx, db, 'platformWhatsAppOutbox/' + job.outboxId) : null;
              const advance = head?.recordType === 'control_head' && head.headJobId === job.jobId && head.controlEpoch === job.controlEpoch && head.controlRevision === job.controlRevision ? await prepareHeadAdvance(head, job, tx, db, now) : null;
              const terminal = { ...job, status: consumed ? 'unknown' as const : 'cancelled' as const, nextAttemptAt: null };
              for (const p of ['audio', 'generation'] as const) if (['preparing', 'started', 'result_pending'].includes(terminal[p + 'State' as `${typeof p}State`])) { terminal[`${p}State`] = 'unknown'; terminal[`${p}FinishedAt`] = now; }
              stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, terminal);
              if (outbox?.recordType === 'outbox' && !['accepted', 'rejected', 'unknown', 'cancelled'].includes(outbox.status)) stageWork(tx, db, 'platformWhatsAppOutbox/' + outbox.outboxId, { ...outbox, status: outbox.status === 'started' ? 'unknown' : 'cancelled', sendFinishedAt: now });
              advance?.(); return null;
            }
            const policy = currentPlatformWorkPolicy(), stage = job.catalogId ? 'send' : job.sourceKind === 'audio' && job.audioState !== 'completed' ? 'audio' : 'generation';
            await readPlatformReservation(job, stage, maximumPlatformCost(policy.policy, stage), tx, db, now);
            const updated: PlatformJob = { ...job, status: 'leased', processingStartedAt: job.processingStartedAt ?? now, processingDeadlineAt: deadline, leaseToken: token, leaseClaimedAt: now, leaseExpiresAt: Math.min(now + WORK_LEASE_MS, deadline), nextAttemptAt: Math.min(now + WORK_LEASE_MS, deadline) };
            stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, updated); return { jobId: job.jobId, epoch: job.epoch, token };
          });
          if (lease) return lease;
        }
      }
      return null;
    },
    async renew(lease: Lease): Promise<boolean> {
      const now = clock(), p = await preparedLease(lease, db, now); if (!p) return false;
      return db.runTransaction(async tx => {
        const job = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId);
        if (job?.recordType !== 'job' || !liveLease(job, lease, now) || !await readWorkAuthority(job, p.prepared, tx, db, now)) return false;
        const expires = Math.min(now + WORK_LEASE_MS, job.processingDeadlineAt!);
        stageWork(tx, db, 'platformWhatsAppJobs/' + job.jobId, { ...job, leaseClaimedAt: now, leaseExpiresAt: expires, nextAttemptAt: job.status === 'leased' ? expires : job.nextAttemptAt }); return true;
      });
    },
    async readAuthorized(lease: Lease): Promise<PlatformJob | null> {
      const now = clock(), p = await preparedLease(lease, db, now); if (!p) return null;
      return db.runTransaction(async tx => { const j = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId); return j?.recordType === 'job' && liveLease(j, lease, now) && await readWorkAuthority(j, p.prepared, tx, db, now) ? j : null; });
    },
    async saveReply(lease: Lease, text: string): Promise<{ outboxId: string }> {
      const now = clock(), p = await preparedLease(lease, db, now); if (!p || !workText(text, 'reply')) throw platformWhatsAppConflictError();
      const id = p.job.outboxId ?? randomUUID(), outbox = prepareOutbox(p.job, p.prepared.payload.customerPhone, text, id, now);
      return db.runTransaction(async tx => {
        const j = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId);
        if (j?.recordType !== 'job' || !liveLease(j, lease, now) || !await readWorkAuthority(j, p.prepared, tx, db, now)) throw platformWhatsAppConflictError();
        if (j.outboxId) { const saved = await readWork(tx, db, 'platformWhatsAppOutbox/' + j.outboxId); if (saved?.recordType !== 'outbox' || saved.outputFingerprint !== outboxFingerprint(j, text, saved.menuPurpose, saved.menuActions)) throw platformWhatsAppConflictError(); return { outboxId: j.outboxId }; }
        if (!j.catalogId || text !== workCatalog[j.catalogId].text || j.generationState !== 'not_applicable' || j.catalogId !== p.job.catalogId || j.epoch !== p.job.epoch) throw platformWhatsAppConflictError();
        stageReply(j, outbox, tx, db); return { outboxId: id };
      });
    },
    async claimSend(outboxId: string): Promise<{ token: string } | null> {
      const now = clock(), p = await readOutboxPreparation(outboxId, db, now); if (!p) return null;
      const token = randomUUID();
      return db.runTransaction(async tx => {
        const [j, o] = await Promise.all([readWork(tx, db, 'platformWhatsAppJobs/' + p.job.jobId), readWork(tx, db, 'platformWhatsAppOutbox/' + outboxId)]);
        if (j?.recordType !== 'job' || o?.recordType !== 'outbox' || o.status !== 'prepared' || j.status !== 'reply_saved' || !outboxMatchesJob(o, j) || j.processingDeadlineAt === null || j.processingDeadlineAt <= now || !await readWorkAuthority(j, p.prepared, tx, db, now) || !workPayload(o, now)) return null;
        const maximum = maximumPlatformCost(currentPlatformWorkPolicy().policy, 'send'), facts = await readPlatformReservation(j, 'send', maximum, tx, db, now);
        if (facts.call && facts.call.status !== 'reserved') return null;
        const reservation = stagePlatformReservation(j, 'send', maximum, facts, tx, db, now);
        stageWork(tx, db, 'platformWhatsAppOutbox/' + outboxId, { ...o, status: 'claimed', sendToken: token, sendClaimedAt: now, sendReservationId: reservation.reservationId }); return { token };
      });
    },
    async finishSend(outboxId: string, token: string, result: DeliveryResult): Promise<void> {
      const now = clock();
      if (!['accepted', 'rejected', 'unknown', 'cancelled'].includes(result.status) || result.status === 'accepted' && !workText(result.providerId, 'provider')) throw platformWhatsAppConflictError();
      const p = await readOutboxPreparation(outboxId, db, now);
      await db.runTransaction(async tx => {
        const o = await readWork(tx, db, 'platformWhatsAppOutbox/' + outboxId);
        if (o?.recordType !== 'outbox' || o.sendToken !== token || !o.sendReservationId) throw platformWhatsAppConflictError();
        if (o.status === 'cancelled' && o.providerId !== null) { if (result.status !== 'accepted' || result.providerId !== o.providerId) throw platformWhatsAppConflictError(); return; }
        if (o.status === 'cancelled' && result.status === 'cancelled') return;
        if (['accepted', 'rejected', 'unknown'].includes(o.status)) { if (o.status !== result.status || o.providerId !== (result.status === 'accepted' ? result.providerId : null)) throw platformWhatsAppConflictError(); return; }
        const j = await readWork(tx, db, 'platformWhatsAppJobs/' + o.jobId);
        if (j?.recordType !== 'job' || !outboxMatchesJob(o, j)) throw platformWhatsAppConflictError();
        if (o.status !== 'started' && o.status !== 'cancelled' && result.status !== 'cancelled') throw platformWhatsAppConflictError();
        const authority = p ? await readWorkAuthority(j, p.prepared, tx, db, now) : null;
        const costs = await readPlatformSettlement(o.sendReservationId, tx, db), head = authority?.head ?? await readWork(tx, db, 'platformWhatsAppJobs/head_' + j.conversationId);
        const current = !!authority && o.status !== 'cancelled' && j.status === 'reply_saved' && j.processingDeadlineAt !== null && now < j.processingDeadlineAt;
        const acceptedHead = current && result.status === 'accepted' ? { ...authority!.head, currentMenuOutboxId: outboxId } : head;
        const advance = acceptedHead?.recordType === 'control_head' && acceptedHead.headJobId === j.jobId && acceptedHead.controlEpoch === j.controlEpoch && acceptedHead.controlRevision === j.controlRevision ? await prepareHeadAdvance(acceptedHead, j, tx, db, now) : null;
        stagePlatformSettlement(costs, costs.call.status === 'reserved' ? 0 : null, emptyUsage, costs.call.effectToken, tx, db, now);
        const status = current ? result.status : 'cancelled';
        stageWork(tx, db, 'platformWhatsAppOutbox/' + outboxId, { ...o, status, sendFinishedAt: now, providerId: result.status === 'accepted' ? result.providerId : o.providerId });
        stageWork(tx, db, 'platformWhatsAppJobs/' + j.jobId, { ...j, status: status === 'unknown' ? 'unknown' : status === 'cancelled' ? 'cancelled' : 'completed', nextAttemptAt: null }); advance?.();
      });
    },
    async cancelConversation(id: string, revision: number): Promise<void> {
      const now = clock();
      await db.runTransaction(async tx => {
        const ref = db.collection('platformWhatsAppConversations').doc(id), value = (await tx.get(ref)).data();
        if (!isPlatformWhatsAppConversationRecord(value) || value.revision !== revision || value.expiresAt <= now) throw platformWhatsAppConflictError();
        const facts = await readWorkCancellation(id, value, tx, db), next = checkedAdd(revision, 1);
        tx.set(ref, { ...value, mode: 'human', revision: next }); stageWorkCancellation(facts, next, tx, db, now);
      });
    },
  };
}
export async function takePlatformSendPermit(outboxId: string, token: string, db: Database, now = Date.now()) {
  const p = await readOutboxPreparation(outboxId, db, now); if (!p) return null;
  return db.runTransaction(async tx => {
    const [j, o] = await Promise.all([readWork(tx, db, 'platformWhatsAppJobs/' + p.job.jobId), readWork(tx, db, 'platformWhatsAppOutbox/' + outboxId)]);
    if (j?.recordType !== 'job' || o?.recordType !== 'outbox' || o.status !== 'claimed' || o.sendToken !== token || !outboxMatchesJob(o, j) || j.status !== 'reply_saved' || j.processingDeadlineAt === null || j.processingDeadlineAt <= now || !await readWorkAuthority(j, p.prepared, tx, db, now)) return null;
    const payload = workPayload(o, now); if (!payload) return null;
    if (o.outputFingerprint !== outboxFingerprint(j, payload.text!, o.menuPurpose, o.menuActions)) throw platformWhatsAppUnavailableError();
    const maximum = maximumPlatformCost(currentPlatformWorkPolicy().policy, 'send'), facts = await readPlatformReservation(j, 'send', maximum, tx, db, now);
    if (!facts.call || facts.call.reservationId !== o.sendReservationId || facts.call.status !== 'reserved') return null;
    if (!stagePlatformCostStart(facts, token, tx, db, now)) return null;
    stageWork(tx, db, 'platformWhatsAppOutbox/' + outboxId, { ...o, status: 'started', sendStartedAt: now });
    return { to: payload.customerPhone, text: payload.text!, buttons: createPlatformMenu(outboxId, o.menuPurpose), externalId: outboxId };
  });
}
export async function takePlatformGenerationPermit(lease: Lease, db: Database, now = Date.now()) {
  const p = await preparedLease(lease, db, now); if (!p) return null;
  const token = randomUUID();
  return db.runTransaction(async tx => {
    const j = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId);
    if (j?.recordType !== 'job' || j.authorityKind !== 'actor' || j.catalogId !== null || j.generationState !== 'not_started' || j.outboxId !== null || !liveLease(j, lease, now) || j.sourceKind === 'audio' && j.audioState !== 'completed' || !await readWorkAuthority(j, p.prepared, tx, db, now)) return null;
    const payload = workPayload(j, now); if (!payload?.question) return null;
    const { policy } = currentPlatformWorkPolicy(), maximum = maximumPlatformCost(policy, 'generation'), facts = await readPlatformReservation(j, 'generation', maximum, tx, db, now);
    if (!facts.call || !stagePlatformCostStart(facts, token, tx, db, now)) return null;
    stageWork(tx, db, 'platformWhatsAppJobs/' + j.jobId, { ...j, generationState: 'started', generationToken: token, generationLeaseToken: lease.token, generationReservationId: facts.call.reservationId, generationStartedAt: now });
    return { generationToken: token, actor: workActor(j), question: payload.question, maximumOutputTokens: policy.tariff.maximumOutputTokens };
  });
}
export async function completePlatformGeneration(lease: Lease, generationToken: string, outcome: { status: 'completed'; text: string; actualMicros: number; usage: Usage } | { status: 'failed' | 'unknown'; actualMicros: number | null; usage: Usage }, db: Database, now = Date.now()) {
  const p = await preparedLease(lease, db, now), id = randomUUID();
  const outbox = p && outcome.status === 'completed' && workText(outcome.text, 'reply') ? prepareOutbox({ ...p.job, generationState: 'completed' }, p.prepared.payload.customerPhone, outcome.text, id, now) : null;
  return db.runTransaction(async tx => {
    const j = await readWork(tx, db, 'platformWhatsAppJobs/' + lease.jobId);
    if (j?.recordType !== 'job' || j.epoch !== lease.epoch || j.generationToken !== generationToken || j.generationLeaseToken !== lease.token || !j.generationReservationId || j.generationState !== 'started') throw platformWhatsAppConflictError();
    const authority = p && liveLease(j, lease, now) ? await readWorkAuthority(j, p.prepared, tx, db, now) : null, facts = await readPlatformSettlement(j.generationReservationId, tx, db);
    const head = authority?.head ?? await readWork(tx, db, 'platformWhatsAppJobs/head_' + j.conversationId);
    const advance = head?.recordType === 'control_head' && head.headJobId === j.jobId && head.controlEpoch === j.controlEpoch && head.controlRevision === j.controlRevision ? await prepareHeadAdvance(head, j, tx, db, now) : null;
    const valid = stagePlatformSettlement(facts, outcome.actualMicros, outcome.usage, generationToken, tx, db, now);
    const updated: PlatformJob = { ...j, generationState: authority && valid ? outcome.status === 'completed' && !outbox ? 'failed' : outcome.status : 'cancelled', generationFinishedAt: now };
    if (authority && valid && outbox && outcome.status === 'completed') { stageReply(updated, outbox, tx, db); return { outboxId: id }; }
    stageWork(tx, db, 'platformWhatsAppJobs/' + j.jobId, { ...updated, status: outcome.status === 'unknown' ? 'unknown' : 'cancelled', nextAttemptAt: null }); advance?.(); return null;
  });
}
