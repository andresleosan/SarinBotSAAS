import { vi } from 'vitest';
import { createCloudflareDatabase, StorageError } from '@/lib/storage/database';
import type { DataCommand, DataRecord, DataReadResult, DataCommitResult } from '../shared/data-protocol';
import type { PlatformWhatsAppConnectionRecord, PlatformWhatsAppConversationRecord, PlatformWhatsAppControlRecord } from '../shared/platform-whatsapp-records';
import { getPlatformWhatsAppConfig } from '@/lib/server/platform-whatsapp-config';

export const now = 1_900_000_000_000;
export const scope = { wabaId: '10001', phoneE164: '+12025550100', phoneNumberId: '20001' };
export const key = Buffer.alloc(32, 71);
export const identity = { version: 1 as const, provider: 'ycloud' as const, purpose: 'platform_support' as const, ...scope };
export const connectionPath = 'serverSettings/platform_whatsapp';
export const conversationId = 'a'.repeat(64);
export function configure() {
  for (const [name, value] of Object.entries({
    PLATFORM_WHATSAPP_RECEIVE_ENABLED: 'true', PLATFORM_WHATSAPP_RETENTION_ENABLED: 'true',
    PLATFORM_WHATSAPP_AI_ENABLED: 'false', PLATFORM_WHATSAPP_SEND_ENABLED: 'false',
    PLATFORM_YCLOUD_WEBHOOK_SECRET: 'demo-only-signing-secret', PLATFORM_WHATSAPP_CONTENT_KEY: key.toString('base64'),
    PLATFORM_WHATSAPP_WABA_ID: scope.wabaId, PLATFORM_WHATSAPP_PHONE_E164: scope.phoneE164, PLATFORM_WHATSAPP_PHONE_NUMBER_ID: scope.phoneNumberId,
  })) vi.stubEnv(name, value);
  return getPlatformWhatsAppConfig();
}
export function connection(overrides: Partial<PlatformWhatsAppConnectionRecord> = {}): PlatformWhatsAppConnectionRecord {
  return { ...identity, recordType: 'connection', connectionRevision: 0, providerConnection: 'unverified', paused: false, pausedReason: null, updatedAt: now,
    connectedAt: null, connectedRevision: null, lastSignedInboundAt: null, lastHumanEchoAt: null, lastDeliveryAt: null, ...overrides };
}
export function conversation(overrides: Partial<PlatformWhatsAppConversationRecord> = {}): PlatformWhatsAppConversationRecord {
  return { ...identity, recordType: 'conversation', state: 'body_erased', mode: 'human', revision: 0, updatedAt: now,
    lastInboundAt: null, lastHumanAt: null, bodyExpiresAt: now + 86_400_000, expiresAt: now + 2_592_000_000,
    previewOccurredAt: now, previewReceivedAt: now, canonicalIdentity: 'b'.repeat(64), contactContent: null, conflictAt: null,
    ...overrides } as PlatformWhatsAppConversationRecord;
}
export function audit(overrides: Partial<PlatformWhatsAppControlRecord> = {}): PlatformWhatsAppControlRecord {
  return { ...identity, recordType: 'control', state: 'connection_control', receivedAt: now, updatedAt: now, expiresAt: now + 2_592_000_000,
    actorUid: 'demo-admin', fingerprint: 'c'.repeat(64), action: 'pause', targetId: 'platform_whatsapp', resultRevision: 1, ...overrides } as PlatformWhatsAppControlRecord;
}
export function incoming(overrides: Record<string, unknown> = {}) {
  return { provider: 'ycloud' as const, eventId: 'demo-event-1', messageId: 'demo-message-1', whatsappMessageId: 'demo-wamid-1',
    occurredAt: now, wabaId: scope.wabaId, businessPhone: scope.phoneE164, customerPhone: '+12025550101',
    kind: 'incoming_text' as const, sourceEventType: 'whatsapp.inbound_message.received' as const, text: 'Synthetic private message', ...overrides };
}
export function echo(overrides: Record<string, unknown> = {}) {
  return { ...incoming(), kind: 'human_echo' as const, sourceEventType: 'whatsapp.smb.message.echoes' as const, messageType: 'image', text: null, ...overrides };
}

/** Synthetic transport beneath the real adapter: bounded query, CAS and atomic journal. */
export function memoryStore() {
  let revision = 0;
  let loseResponse = false;
  const rows = new Map<string, DataRecord>();
  const journal = new Map<string, { signature: string; revision: number }>();
  const seen: DataCommand[] = [];
  const value = (row: DataRecord, field: string): any => field.split('.').reduce<any>((v, name) => v?.[name], row);
  const transport = async (command: DataCommand): Promise<DataReadResult | DataCommitResult> => {
    seen.push(structuredClone(command));
    if (command.action === 'read') {
      const spec = command.read;
      let documents = [...rows].filter(([path]) => spec.kind === 'document' ? path === spec.path : path.startsWith(spec.path + '/') && path.split('/').length === spec.path.split('/').length + 1)
        .map(([path, data]) => ({ path, data: structuredClone(data) }));
      if (spec.kind === 'query') {
        documents = documents.filter(({ data }) => spec.filters.every(f => {
          const actual = value(data, f.field);
          return actual !== undefined && ({ '==': () => actual === f.value, '<': () => actual < f.value!, '<=': () => actual <= f.value!, '>': () => actual > f.value!, '>=': () => actual >= f.value! }[f.op])();
        }));
        documents.sort((a, b) => {
          for (const order of spec.order) {
            const x = value(a.data, order.field), y = value(b.data, order.field);
            if (x !== y) return (x < y ? -1 : 1) * (order.direction === 'desc' ? -1 : 1);
          }
          return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
        });
        documents = documents.slice(0, spec.limit ?? 1000);
      }
      return { revision, documents };
    }
    const signature = JSON.stringify(command);
    const replay = journal.get(command.requestId);
    if (replay) {
      if (replay.signature !== signature) throw new StorageError(409, 'DATA_CONFLICT');
      return { revision: replay.revision };
    }
    if (command.expectedRevision !== revision) throw new StorageError(409, 'DATA_CONFLICT');
    const staged = new Map(rows);
    for (const write of command.writes) {
      if (write.op === 'create' && staged.has(write.path)) throw new StorageError(409, 'DATA_EXISTS');
      if (write.op === 'delete') staged.delete(write.path);
      else staged.set(write.path, structuredClone(write.merge ? { ...staged.get(write.path), ...write.data } : write.data));
    }
    rows.clear(); for (const [path, data] of staged) rows.set(path, data);
    journal.set(command.requestId, { signature, revision: ++revision });
    if (loseResponse) { loseResponse = false; throw new TypeError('Synthetic lost durable response'); }
    return { revision };
  };
  return { rows, seen, transport, db: createCloudflareDatabase(transport),
    seed(path: string, data: object) { rows.set(path, structuredClone(data) as DataRecord); revision++; },
    loseNextResponse() { loseResponse = true; },
  };
}
