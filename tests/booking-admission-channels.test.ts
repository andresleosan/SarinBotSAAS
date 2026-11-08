import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
import { syntheticWhatsAppEnv, whatsappRows, phoneId, wabaId, sender } from './whatsapp-fixtures';
import { persistWhatsAppReply } from '@/lib/server/whatsapp-store';
import { encryptWhatsApp } from '@/lib/server/whatsapp-security';
import { processWhatsAppQueue } from '@/lib/server/whatsapp-worker';
import { bookingDataPolicyKey } from '@/lib/server/booking-data-policy';
import { admissionPolicy } from './booking-admission-storage-contract';
import type { WhatsAppOutbox } from '@/lib/server/whatsapp-store';

const reservation = { reservationId: 'r'.repeat(64), scopeId: 'business_a', periodId: 'period-a', attemptId: 'attempt-a' };
const documents = (rows: ReturnType<typeof memoryFirestore>['rows'], collection: string) => [...rows].filter(([path]) => path.startsWith(`${collection}/`));

describe('R0-POLICY-B4 WhatsApp channel admission and outbox lifecycle', () => {
  beforeEach(() => {
    syntheticWhatsAppEnv();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.outgoing-test' }] })));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('persists policyRevision into whatsappOutbox inside persistWhatsAppReply transaction', async () => {
    const policy = { ...admissionPolicy, businessId: 'business_a', revision: 5, status: 'active' as const };
    const { db, rows } = memoryFirestore({
      ...whatsappRows(),
      'businesses/business_a': { id: 'business_a', ownerUid: 'demo-owner' },
      [`serverSettings/${bookingDataPolicyKey('business_a')}`]: policy,
      'whatsappConversations/conv-1': {
        businessId: 'business_a',
        phoneNumberId: phoneId,
        wabaId,
        mode: 'bot',
        revision: 1,
        updatedAt: Date.now(),
        lastInboundAt: Date.now(),
        lastHumanAt: null,
        controlChangedAt: Date.now(),
        bodyExpiresAt: Date.now() + 86400000,
        expiresAt: Date.now() + 86400000,
      },
      'whatsappInbox/inbox-1': {
        businessId: 'business_a',
        phoneNumberId: phoneId,
        wabaId,
        conversationId: 'conv-1',
        conversationRevision: 1,
        state: 'processing',
        leaseId: 'lease-1',
        receivedAt: Date.now() - 5000,
        windowEndsAt: Date.now() + 86400000,
        bodyExpiresAt: Date.now() + 86400000,
        expiresAt: Date.now() + 86400000,
        nextAttemptAt: Date.now() + 60000,
        content: encryptWhatsApp({ from: sender, text: 'Hola', messageId: 'wamid.123' }, 'whatsappInbox/inbox-1'),
      },
    });

    await persistWhatsAppReply('inbox-1', 'lease-1', { reply: 'Respuesta con política activa' }, reservation, db);

    const outboxRows = documents(rows, 'whatsappOutbox');
    expect(outboxRows).toHaveLength(1);
    const outboxData = outboxRows[0][1].data as unknown as unknown as WhatsAppOutbox;
    expect(outboxData.policyRevision).toBe(5);
    expect(outboxData.state).toBe('ready');
  });

  it('cancels ready outbox when policy becomes incompatible before send without dispatching fetch', async () => {
    const policy = { ...admissionPolicy, businessId: 'business_a', revision: 5, status: 'active' as const };
    const { db, rows } = memoryFirestore({
      ...whatsappRows(),
      [`serverSettings/${bookingDataPolicyKey('business_a')}`]: policy,
      'whatsappOutbox/out-ready-1': {
        businessId: 'business_a',
        phoneNumberId: phoneId,
        wabaId,
        conversationId: 'conv-1',
        conversationRevision: 1,
        policyRevision: 5,
        state: 'ready',
        createdAt: Date.now() - 5000,
        windowEndsAt: Date.now() + 86400000,
        bodyExpiresAt: Date.now() + 86400000,
        expiresAt: Date.now() + 86400000,
        nextAttemptAt: Date.now() - 1000,
        content: encryptWhatsApp({ to: sender, reply: 'Mensaje pendiente', messageId: 'wamid.inbound-1' }, 'whatsappOutbox/out-ready-1'),
        reservation,
        sent: false,
        delivered: false,
        read: false,
        failed: false,
        attempts: 0,
      },
    });

    // Policy revision changed or withdrawn
    await db.collection('serverSettings').doc(bookingDataPolicyKey('business_a')).set({ ...policy, revision: 6, status: 'withdrawn' });

    await processWhatsAppQueue(db);

    const outboxData = (await db.collection('whatsappOutbox').doc('out-ready-1').get()).data() as WhatsAppOutbox;
    expect(outboxData.state).toBe('cancelled');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('transitions sending outbox to unknown upon crash and never resends unknown outbox', async () => {
    const policy = { ...admissionPolicy, businessId: 'business_a', revision: 5, status: 'active' as const };
    const { db } = memoryFirestore({
      ...whatsappRows(),
      [`serverSettings/${bookingDataPolicyKey('business_a')}`]: policy,
      'whatsappOutbox/out-sending-1': {
        businessId: 'business_a',
        phoneNumberId: phoneId,
        wabaId,
        conversationId: 'conv-1',
        conversationRevision: 1,
        policyRevision: 5,
        state: 'sending',
        createdAt: Date.now() - 5000,
        windowEndsAt: Date.now() + 86400000,
        bodyExpiresAt: Date.now() + 86400000,
        expiresAt: Date.now() + 86400000,
        nextAttemptAt: Date.now() - 1000,
        content: encryptWhatsApp({ to: sender, reply: 'Mensaje en vuelo', messageId: 'wamid.inbound-2' }, 'whatsappOutbox/out-sending-1'),
        reservation,
        sent: false,
        delivered: false,
        read: false,
        failed: false,
        attempts: 1,
      },
      'whatsappOutbox/out-unknown-1': {
        businessId: 'business_a',
        phoneNumberId: phoneId,
        wabaId,
        conversationId: 'conv-1',
        conversationRevision: 1,
        policyRevision: 5,
        state: 'unknown',
        createdAt: Date.now() - 5000,
        windowEndsAt: Date.now() + 86400000,
        bodyExpiresAt: Date.now() + 86400000,
        expiresAt: Date.now() + 86400000,
        nextAttemptAt: Date.now() - 1000,
        content: encryptWhatsApp({ to: sender, reply: 'Mensaje incierto', messageId: 'wamid.inbound-3' }, 'whatsappOutbox/out-unknown-1'),
        reservation,
        sent: false,
        delivered: false,
        read: false,
        failed: false,
        attempts: 1,
      },
    });

    await processWhatsAppQueue(db);

    const sendingData = (await db.collection('whatsappOutbox').doc('out-sending-1').get()).data() as WhatsAppOutbox;
    expect(sendingData.state).toBe('unknown');

    const unknownData = (await db.collection('whatsappOutbox').doc('out-unknown-1').get()).data() as WhatsAppOutbox;
    expect(unknownData.state).toBe('unknown');

    // No network requests attempted for sending or unknown
    expect(fetch).not.toHaveBeenCalled();
  });
});
