import 'server-only';
import { getAdminDb } from '@/lib/firebase/admin';
import type { Database } from '@/lib/storage/types';
import { isPlatformOutbox, workCatalog, WORK_RENEW_MS, type Lease, type PlatformJob } from '../../../shared/platform-whatsapp-work';
import { getPlatformWhatsAppConfig } from './platform-whatsapp-config';
import { createPlatformWorkStore, readOutboxPreparation, readAuthorizedOutbox, takePlatformSendPermit } from './platform-whatsapp-work-store';
import { transcribePlatformAudio } from './platform-whatsapp-audio';
import { preparePlatformAudioFallback } from './platform-whatsapp-work-audio';
import { reconcilePlatformConnection } from './platform-whatsapp-connection';
import { createPlatformYCloudClient } from './platform-ycloud-client';
import { runPlatformSupportWork } from './platform-support-bot';
import { hasDuePlatformWork, dueWork, platformWorkCandidates } from './platform-whatsapp-work-queue';
import { boundedPlatformCandidates } from '../../../shared/platform-whatsapp-work-authorization';

type Owned = { controller: AbortController; job: PlatformJob; db: Database; lease?: Lease };
type Driver = { draining: boolean; pending: boolean; timer: ReturnType<typeof setTimeout> | null; owned: Map<string, Owned> };
const global = globalThis as typeof globalThis & { __platformWorkDriver?: Driver };
const state = () => global.__platformWorkDriver ??= { draining: false, pending: false, timer: null, owned: new Map() };
const enabled = () => process.env.PLATFORM_WHATSAPP_PROCESSING_ENABLED === 'true' && process.env.SARIN_MAINTENANCE !== 'true';
/** Notification only after durable commit. No caller supplies positive authority. */
export async function recognizePlatformWorkCancellation(conversationId?: string): Promise<void> {
  for (const owned of state().owned.values()) {
    if (conversationId && owned.job.conversationId !== conversationId) continue;
    try {
      const valid = owned.lease ? await createPlatformWorkStore(owned.db).readAuthorized(owned.lease) : owned.job.outboxId && await readAuthorizedOutbox(owned.job.outboxId, owned.db, Date.now());
      if (!valid) owned.controller.abort();
    } catch { owned.controller.abort(); }
  }
}
function cancelled<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException('Cancelado.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelado.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {});
  });
}
async function sendOutbox(id: string, db: Database, parentSignal?: AbortSignal): Promise<void> {
  const store = createPlatformWorkStore(db), initial = await readOutboxPreparation(id, db, Date.now());
  if (!initial || !['prepared', 'claimed'].includes(initial.outbox.status) || initial.job.processingDeadlineAt === null || initial.job.processingDeadlineAt <= Date.now()) return;
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, ...parentSignal ? [parentSignal] : []]);
  const key = 'send:' + id; if (state().owned.has(key)) return;
  state().owned.set(key, { controller, job: initial.job, db });
  const deadline = setTimeout(() => controller.abort(), Math.max(0, initial.job.processingDeadlineAt - Date.now())); deadline.unref();
  try {
    signal.throwIfAborted();
    await cancelled(reconcilePlatformConnection(db), signal);
    const config = getPlatformWhatsAppConfig(); if (!enabled() || !config.scope || !config.sendEnabled) return;
    const client = createPlatformYCloudClient({ scope: config.scope, apiKey: process.env.PLATFORM_YCLOUD_API_KEY ?? '', sendEnabled: config.sendEnabled });
    const claim = initial.outbox.status === 'claimed' && initial.outbox.sendToken ? { token: initial.outbox.sendToken } : await store.claimSend(id);
    if (!claim) return;
    signal.throwIfAborted();
    const permit = await takePlatformSendPermit(id, claim.token, db);
    if (!permit) return;
    signal.throwIfAborted();
    let result: Awaited<ReturnType<typeof client.sendButtons>>;
    try { result = await cancelled(client.sendButtons({ ...permit, signal }), signal); } catch { result = { status: 'unknown' }; }
    await store.finishSend(id, claim.token, result);
  } finally { clearTimeout(deadline); state().owned.delete(key); }
}
export async function processPlatformWhatsAppWork(lease: Lease, callerSignal?: AbortSignal): Promise<void> {
  if (!enabled()) return;
  const db = getAdminDb(), store = createPlatformWorkStore(db);
  const job = await store.readAuthorized(lease); if (!job || job.processingDeadlineAt === null || ['admin_query', 'operator_notification'].includes(job.kind)) return;
  const key = 'job:' + job.jobId; if (state().owned.has(key)) return;
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, ...callerSignal ? [callerSignal] : []]);
  state().owned.set(key, { controller, job, db, lease });
  let renewing = false;
  const deadline = setTimeout(() => controller.abort(), Math.max(0, job.processingDeadlineAt - Date.now())); deadline.unref();
  const renewal = setInterval(() => { if (renewing) return; renewing = true; void store.renew(lease).then(ok => { if (!ok) controller.abort(); }, () => controller.abort()).finally(() => { renewing = false; }); }, WORK_RENEW_MS); renewal.unref();
  try {
    let outboxId: string | null = job.outboxId;
    signal.throwIfAborted();
    if (job.catalogId) outboxId = (await store.saveReply(lease, workCatalog[job.catalogId].text)).outboxId;
    else {
      if (job.sourceKind === 'audio' && job.audioState !== 'completed') {
        if (process.env.PLATFORM_WHATSAPP_TRANSCRIPTION_ENABLED !== 'true') return;
        await cancelled(reconcilePlatformConnection(db), signal);
        if (!await store.readAuthorized(lease)) return;
        const audio = await cancelled(transcribePlatformAudio(lease, signal), signal);
        if (!audio.ok) {
          if (audio.reason !== 'denied' && !signal.aborted) outboxId = (await preparePlatformAudioFallback(lease, db))?.outboxId ?? null;
          if (outboxId) await sendOutbox(outboxId, db, signal);
          return;
        }
      }
      signal.throwIfAborted();
      await cancelled(runPlatformSupportWork(lease, db, signal), signal);
      outboxId = (await store.readAuthorized(lease))?.outboxId ?? null;
    }
    if (outboxId && !signal.aborted) await sendOutbox(outboxId, db, signal);
  } finally { clearTimeout(deadline); clearInterval(renewal); controller.abort(); state().owned.delete(key); }
}
async function drain(): Promise<void> {
  const driver = state(); if (driver.draining || !enabled()) return;
  driver.draining = true; driver.pending = false;
  try {
    const db = getAdminDb(), store = createPlatformWorkStore(db);
    await recognizePlatformWorkCancellation();
    if (await hasDuePlatformWork(db, Date.now())) await reconcilePlatformConnection(db);
    let previous = '';
    for (let pass = 0; pass < 100; pass++) {
      // Return to unsent recovery after each bounded claim/cleanup page. Never select started/unknown.
      for (const status of ['prepared', 'claimed']) {
        for await (const row of boundedPlatformCandidates((root, state, after) => platformWorkCandidates(db, root, state, after), 'platformWhatsAppOutbox', status)) {
          const out = row.data;
          if (!isPlatformOutbox(out) || row.path !== 'platformWhatsAppOutbox/' + out.outboxId) continue;
          try { await sendOutbox(out.outboxId, db); } catch { /* No recovery of an ambiguous started effect. */ }
        }
      }
      const pages = await Promise.all(['advance', 'leased', 'reply_saved', 'ready'].map(status => dueWork(db, status, Date.now()).get()));
      const selected = pages.flatMap(page => page.docs.map(doc => { const row = doc.data(); return [doc.id, row.status, row.nextAttemptAt, row.headJobId ?? null]; }));
      const signature = JSON.stringify(selected);
      if (!selected.length || signature === previous) break;
      previous = signature;
      const lease = await store.claimNext();
      if (lease) { try { await processPlatformWhatsAppWork(lease); } catch { /* Durable stages retain uncertainty. */ } previous = ''; continue; }
    }
    if (await hasDuePlatformWork(db, Date.now())) {
      if (!driver.timer) { driver.timer = setTimeout(() => { driver.timer = null; kickPlatformWhatsAppWorker(); }, 30000); driver.timer.unref(); }
    } else if (!driver.owned.size && driver.timer) { clearTimeout(driver.timer); driver.timer = null; }
  } catch { /* Operational failure is not positive work evidence or a retry permit. */ }
  finally { driver.draining = false; if (driver.pending) kickPlatformWhatsAppWorker(); }
}
export function kickPlatformWhatsAppWorker(): void {
  if (!enabled()) return;
  const driver = state(); driver.pending = true;
  if (!driver.draining) void drain();
}
export function startPlatformWhatsAppWorker(): void { kickPlatformWhatsAppWorker(); }
