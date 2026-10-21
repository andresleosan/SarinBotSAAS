import { beginPlatformWhatsAppLink, verifyPlatformWhatsAppLinkInbound, confirmPlatformWhatsAppLink } from '@/lib/server/platform-whatsapp-link';
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { createPlatformWorkStore, takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
import { reservePlatformCost } from '@/lib/server/platform-whatsapp-budget';
import { configureLink, seedConsents, token, phone } from './platform-whatsapp-link-fixtures';
import { now, memoryStore, incoming, connection, connectionPath } from './platform-whatsapp-test-fixtures';
import { configureWork, workCircuit } from './platform-whatsapp-work-fixtures';
import { workCatalog } from '../shared/platform-whatsapp-work';

/** Real link, menus, accepted outboxes and actor audio ingress; no seeded actors. */
export async function buildWorkAudioScenario() {
  configureLink(); configureWork(); const s = memoryStore(), work = createPlatformWorkStore(s.db, () => now); let seq = 0;
  s.seed(connectionPath, { ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: now });
  for (const stage of ['audio', 'generation', 'send'] as const) { const c = workCircuit(undefined, stage); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c); }
  await seedConsents(s.db);
  const c = await beginPlatformWhatsAppLink(token(), { phoneE164: phone, requestId: 'demo-a3-begin' }, s.db, now);
  await verifyPlatformWhatsAppLinkInbound(incoming({ text: c.code }), s.db, now);
  await confirmPlatformWhatsAppLink(token(), { challengeId: c.challengeId, requestId: 'demo-a3-confirm' }, s.db, now);
  const event = (patch = {}) => incoming({ eventId: 'demo-scenario-' + ++seq, messageId: 'demo-scenario-' + seq, whatsappMessageId: null, customerSentAt: now, ...patch });
  async function deliver() {
    const lease = (await work.claimNext())!, job = (await work.readAuthorized(lease))!;
    const out = await work.saveReply(lease, workCatalog[job.catalogId!].text), claim = (await work.claimSend(out.outboxId))!;
    await takePlatformSendPermit(out.outboxId, claim.token, s.db, now); await work.finishSend(out.outboxId, claim.token, { status: 'accepted', providerId: 'demo-provider-' + seq }); return out.outboxId;
  }
  async function choose(id: string, action: string) { const { text: _text, ...base } = event(); await ingest({ ...base, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:${action}:${id}` }, getPlatformWhatsAppConfig(), s.db, now); }
  await ingest(event(), getPlatformWhatsAppConfig(), s.db, now); await choose(await deliver(), 'accept'); await choose(await deliver(), 'support'); await deliver();
  const { text: _text, ...base } = event();
  await ingest({ ...base, kind: 'incoming_audio', audio: { id: '123456789', link: 'https://api.ycloud.com/v2/whatsapp/media/download/123456789', sha256: Buffer.alloc(32, 7).toString('base64'), mimeType: 'audio/ogg; codecs=opus' } }, getPlatformWhatsAppConfig(), s.db, now);
  const lease = (await work.claimNext())!; await reservePlatformCost(lease.jobId, 'audio', 1, s.db);
  return { ...s, work, lease };
}
