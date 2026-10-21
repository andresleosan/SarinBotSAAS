import type { DataCommand, DataWrite } from '../../shared/data-protocol.ts';
import { isPlatformWhatsAppConversationRecord, isPlatformWhatsAppEventRecord, isPlatformWhatsAppStoredEvent } from '../../shared/platform-whatsapp-records.ts';
import { DataError, executeDataCommand } from './data.ts';

type RetentionEnvironment = Parameters<typeof executeDataCommand>[1];
type RetentionCollection = 'platformWhatsAppEvents' | 'platformWhatsAppConversations';

async function cleanupPhase(env: RetentionEnvironment, collection: RetentionCollection, bodies: boolean, now: number, batchLimit: number) {
  let command: Extract<DataCommand, { action: 'commit' }> | undefined;
  let invalidRecords = 0;
  let morePending = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!command) {
        const field = bodies ? 'bodyExpiresAt' : 'expiresAt';
        const selected = await executeDataCommand({ action: 'read', read: {
          kind: 'query',
          path: collection,
          filters: [...bodies ? [{ field: 'state', op: '==', value: 'body_present' }] : [], { field, op: '<=', value: now }],
          order: [{ field, direction: 'asc' }],
          limit: batchLimit,
        } }, env);
        if (!('documents' in selected)) throw new Error('Unexpected retention read result');
        const writes: DataWrite[] = [];
        invalidRecords = 0;
        for (const { path, data } of selected.documents) {
          const valid = collection === 'platformWhatsAppConversations' ? isPlatformWhatsAppConversationRecord(data) : bodies ? isPlatformWhatsAppEventRecord(data) : isPlatformWhatsAppStoredEvent(data);
          if (!valid) {
            invalidRecords++;
            continue;
          }
          if (!bodies) writes.push({ op: 'delete', path });
          else writes.push({ op: 'set', path, data: {
            ...data,
            state: 'body_erased',
            [collection === 'platformWhatsAppEvents' ? 'content' : 'contactContent']: null,
          } });
        }
        morePending = selected.documents.length === batchLimit || invalidRecords > 0;
        if (!writes.length) return { changed: 0, morePending, invalidRecords, failedPhases: 0 };
        command = { action: 'commit', expectedRevision: selected.revision, requestId: crypto.randomUUID(), writes };
      }
      await executeDataCommand(command, env);
      return { changed: command.writes.length, morePending, invalidRecords, failedPhases: 0 };
    } catch (error) {
      if (error instanceof DataError && error.code === 'DATA_CONFLICT') command = undefined;
    }
  }
  return { changed: 0, morePending: true, invalidRecords, failedPhases: 1 };
}

export async function cleanupPlatformWhatsAppRetention(env: RetentionEnvironment, options: { now?: number; batchLimit?: number } = {}) {
  const now = options.now ?? Date.now();
  const batchLimit = options.batchLimit ?? 50;
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 || !Number.isInteger(batchLimit) || batchLimit < 1 || batchLimit > 50) {
    throw new Error('Invalid retention options');
  }
  const result = { clearedBodies: 0, deletedMetadata: 0, morePending: false };
  let invalidRecords = 0;
  let failedPhases = 0;
  for (const bodies of [true, false]) {
    for (const collection of ['platformWhatsAppEvents', 'platformWhatsAppConversations'] as const) {
      const phase = await cleanupPhase(env, collection, bodies, now, batchLimit);
      if (bodies) result.clearedBodies += phase.changed;
      else result.deletedMetadata += phase.changed;
      result.morePending ||= phase.morePending;
      invalidRecords += phase.invalidRecords;
      failedPhases += phase.failedPhases;
    }
  }
  if (invalidRecords || failedPhases) console.warn({ event: 'platform_whatsapp_retention_incomplete', invalidRecords, failedPhases });
  return result;
}
