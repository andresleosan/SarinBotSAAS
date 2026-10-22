import { configureLink, seedConsents, token, phone } from './platform-whatsapp-link-fixtures';
import { configureWork, configureGenerationWork, workCircuit } from './platform-whatsapp-work-fixtures';
import { now, memoryStore, incoming, connection, connectionPath } from './platform-whatsapp-test-fixtures';
import { beginPlatformWhatsAppLink, verifyPlatformWhatsAppLinkInbound, confirmPlatformWhatsAppLink } from '@/lib/server/platform-whatsapp-link';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';
import { ingestPlatformWhatsAppEvent as ingest } from '@/lib/server/platform-whatsapp-ingress';
import { createPlatformWorkStore, takePlatformSendPermit } from '@/lib/server/platform-whatsapp-work-store';
import { workCatalog } from '../shared/platform-whatsapp-work';
export async function buildSupportScenario() {
  configureLink(); configureWork(); configureGenerationWork();
  const s = memoryStore(), work = createPlatformWorkStore(s.db), config = getPlatformWhatsAppConfig(); let sequence = 0;
  s.seed(connectionPath, { ...connection({ providerConnection: 'connected' }), observationStatus: 'connected', observationRevision: 0, observedAt: now });
  for (const stage of ['audio', 'generation', 'send'] as const) { const c = workCircuit(undefined, stage); s.seed('platformWhatsAppBudgetPeriods/' + c.circuitId, c); }
  await seedConsents(s.db);
  const challenge = await beginPlatformWhatsAppLink(token(), { phoneE164: phone, requestId: 'synthetic-a5-link' }, s.db, now);
  await verifyPlatformWhatsAppLinkInbound(incoming({ text: challenge.code }), s.db, now);
  await confirmPlatformWhatsAppLink(token(), { challengeId: challenge.challengeId, requestId: 'synthetic-a5-confirm' }, s.db, now);
  const event = (text = 'Consulta pública') => incoming({ eventId: 'synthetic-a5-' + ++sequence, messageId: 'synthetic-a5-' + sequence, whatsappMessageId: null, customerSentAt: now, text });
  async function deliver() {
    const lease = (await work.claimNext())!, job = (await work.readAuthorized(lease))!;
    const out = await work.saveReply(lease, workCatalog[job.catalogId!].text), claim = (await work.claimSend(out.outboxId))!;
    await takePlatformSendPermit(out.outboxId, claim.token, s.db, now);
    await work.finishSend(out.outboxId, claim.token, { status: 'accepted', providerId: 'synthetic-provider-' + out.outboxId }); return out.outboxId;
  }
  async function choose(id: string, action: string) { const { text: _text, ...base } = event(); await ingest({ ...base, kind: 'incoming_choice', choiceId: `sarinbot.menu.v1:${action}:${id}` }, config, s.db, now); }
  await ingest(event(), config, s.db, now); await choose(await deliver(), 'accept'); await choose(await deliver(), 'support'); await deliver();
  async function question(text = '¿Cómo funciona el soporte?') { const source = event(text); await ingest(source, config, s.db, now); return { source, lease: (await work.claimNext())! }; }
  return { ...s, work, question, event };
}
