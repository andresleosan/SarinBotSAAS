import 'server-only';
import type { Database } from '@/lib/storage/types';
import type { AdminCopilotAnswer, AdminCopilotSource } from '@/types/admin-copilot';
import type { PlatformAdminMenu } from '@/types/platform-whatsapp';
import type { PlatformActor } from '../../../shared/platform-whatsapp-authorization';
import { isPlatformWhatsAppLinkRecord } from '../../../shared/platform-whatsapp-link-records';
import { getAdminDb } from '@/lib/firebase/admin';
import { isSuperadmin } from './auth';
import { HttpError } from './http';
import { readWork } from './platform-whatsapp-work-records';
import { prepareWorkIdentity, readWorkAuthority, workActor } from './platform-whatsapp-work-authority';
import { readAdminCopilotSnapshot } from './admin-copilot';
import { listPlatformWhatsAppConversations } from './platform-whatsapp-conversations';
import { answerBoundPlatformAdmin, platformAdminDatabase } from './platform-support-bot';
import { listSupportConversations } from './platform-support';

const denied = () => new HttpError(403, 'La administracion privada no esta autorizada.', 'PLATFORM_ADMIN_DENIED');
/** Current Firebase is prepared outside the supplied database transaction; D1 rechecks exact durable facts. */
export async function assertPlatformSuperadmin(actor: PlatformActor, db?: Database): Promise<void> {
  if (!actor || !isSuperadmin(actor.uid)) throw denied();
  const database = db ?? getAdminDb();
  const now = Date.now();
  const link = (await database.collection('platformWhatsAppLinks').doc('link_' + actor.linkId).get()).data();
  if (!isPlatformWhatsAppLinkRecord(link)) throw denied();
  const job = await database.runTransaction(async tx => {
    const head = await readWork(tx, database, 'platformWhatsAppJobs/head_' + link.conversationId);
    return head?.recordType === 'control_head' && head.headJobId ? readWork(tx, database, 'platformWhatsAppJobs/' + head.headJobId) : null;
  });
  if (job?.recordType !== 'job' || job.kind !== 'admin_query' || !['leased', 'reply_saved'].includes(job.status) || job.processingDeadlineAt === null || job.processingDeadlineAt <= now || job.authorityKind !== 'actor' || JSON.stringify(workActor(job)) !== JSON.stringify(actor)) throw denied();
  const prepared = await prepareWorkIdentity(job, database, now);
  if (!prepared) throw denied();
  const valid = await database.runTransaction(async tx => {
    const current = await readWork(tx, database, 'platformWhatsAppJobs/' + job.jobId);
    return current?.recordType === 'job' && current.epoch === job.epoch && current.authorityKind === 'actor' && JSON.stringify(workActor(current)) === JSON.stringify(actor) && await readWorkAuthority(current, prepared, tx, database, Date.now());
  });
  if (!valid || !isSuperadmin(actor.uid)) throw denied();
}
export async function answerPlatformAdmin(actor: PlatformActor, input: { requestId: string; question: string; businessId?: string }, signal: AbortSignal): Promise<AdminCopilotAnswer> {
  if (!actor || !isSuperadmin(actor.uid)) throw denied();
  return answerBoundPlatformAdmin(actor, input, signal);
}
export async function readPlatformAdminMenu(actor: PlatformActor): Promise<PlatformAdminMenu> {
  if (!actor || !isSuperadmin(actor.uid)) throw denied();
  return (await readPlatformAdminContext(actor, platformAdminDatabase(actor))).menu;
}
export async function readPlatformAdminContext(actor: PlatformActor, db: Database) {
  await assertPlatformSuperadmin(actor, db);
  const snapshot = await readAdminCopilotSnapshot(undefined, db);
  await assertPlatformSuperadmin(actor, db);
  const inbox = await listPlatformWhatsAppConversations(db);
  await assertPlatformSuperadmin(actor, db);
  let web = 0, webCoverage = 'no disponible';
  try { const page = await listSupportConversations({ uid: actor.uid, role: 'admin' }, null, db); web = page.conversations.length; webCoverage = page.hasMore ? 'truncada a una página' : 'sin truncamiento observado'; }
  catch (e) { if (!(e instanceof HttpError) || e.status !== 503) throw e; }
  await assertPlatformSuperadmin(actor, db);
  const support = inbox.conversations.filter(c => c.contentAvailable).length + web;
  const limitations = [snapshot.coverage.paymentsTruncated && 'pagos truncados', snapshot.coverage.businessesTruncated && 'negocios truncados', inbox.truncated && 'WhatsApp parcial', webCoverage !== 'sin truncamiento observado' && 'web ' + webCoverage].filter(Boolean);
  const channelSummary = `Consultados: ${snapshot.metrics.pendingPayments} pagos; ${support} consultas (no totales). Cobertura: ${limitations.join(', ') || 'sin truncamiento observado'}. Cupos sin verificar: ${snapshot.coverage.allowancesUnavailable}. Conexión observada; motor sin verificar.`;
  return { snapshot, channelSummary, menu: { payments: snapshot.metrics.pendingPayments, support,
    health: `Registros consultados; pagos ${snapshot.coverage.paymentsTruncated ? 'truncados' : 'sin truncamiento observado'}; negocios ${snapshot.coverage.businessesTruncated ? 'truncados' : 'sin truncamiento observado'}; cupos no disponibles: ${snapshot.coverage.allowancesUnavailable}; soporte WhatsApp ${inbox.truncated ? 'truncado o no disponible' : 'sin truncamiento observado'}; consultas web vigentes ${web}, cobertura ${webCoverage}. Conexion observada recientemente; no acredita salud del motor. Conteos consultados, no totales ni no leídos.` } };
}

/** Approved application origin; only server-owned protected source paths. */
export function platformAdminSourceUrl(source: AdminCopilotSource): string {
  const expected = source.kind === 'business' ? `/admin#${source.id}` : `/admin?focusPayment=${encodeURIComponent(source.id.slice(8))}#${source.id}`;
  if (!/^(business|payment)-[A-Za-z0-9_-]+$/.test(source.id) || source.href !== expected) throw denied();
  return 'https://sarinbotsaas.pages.dev' + expected;
}
