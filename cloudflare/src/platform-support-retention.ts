import { isSupportRecord, isSupportRecipient } from '../../shared/platform-support-records.ts';
import type { DataCommand, DataWrite } from '../../shared/data-protocol.ts';
import { DataError, executeDataCommand } from './data.ts';
type Env = Parameters<typeof executeDataCommand>[1];
/** This cleaner must remain deployed on application rollback while C rows exist. */
export async function cleanupPlatformSupportRetention(env: Env, now = Date.now(), limit = 50) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid support retention bounds');
  const total = { clearedBodies: 0, deletedMetadata: 0, invalidRecords: 0, failedPhases: 0, morePending: false };
  for (const phase of ['bodies', 'messages', 'conversations', 'recipient'] as const) {
    let command: Extract<DataCommand, { action: 'commit' }> | undefined, invalid = 0, more = false, completed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!command) {
          const root = phase === 'conversations' ? 'platformSupportConversations' : 'platformSupportMessages', field = phase === 'bodies' ? 'bodyExpiresAt' : 'expiresAt';
          const result = await executeDataCommand({ action: 'read', read: phase === 'recipient' ? { kind: 'document', path: 'platformSettings/platform_support_recipient' } : { kind: 'query', path: root, filters: [...phase === 'bodies' ? [{ field: 'bodyState', op: '==' as const, value: 'body_present' }] : [], { field, op: '<=', value: now }], order: [{ field, direction: 'asc' }], limit } }, env);
          if (!('documents' in result)) throw new Error('Invalid support cleanup read');
          const writes: DataWrite[] = []; invalid = 0;
          for (const row of result.documents) {
            // Exact reread tied to the page revision; replacement/successor rows are never swept blindly.
            const current = await executeDataCommand({ action: 'read', read: { kind: 'document', path: row.path } }, env);
            if (!('documents' in current) || current.revision !== result.revision) throw new DataError(409, 'DATA_CONFLICT');
            const data = current.documents[0]?.data;
            if (phase === 'recipient') { if (!data) continue; if (!isSupportRecipient(data)) { invalid++; continue; } if (data.expiresAt <= now) writes.push({ op: 'delete', path: row.path }); continue; }
            if (!isSupportRecord(row.path, data) || data.recordType === 'key_marker') { invalid++; continue; }
            if (phase === 'bodies') {
              if (data.recordType !== 'message' || data.bodyState !== 'body_present' || data.bodyExpiresAt > now) { invalid++; continue; }
              writes.push({ op: 'set', path: row.path, data: { ...data, bodyState: 'body_erased', content: null } });
            } else if (data.expiresAt <= now) writes.push({ op: 'delete', path: row.path });
          }
          more = phase !== 'recipient' && result.documents.length === limit || invalid > 0;
          if (!writes.length) { completed = true; break; }
          command = { action: 'commit', expectedRevision: result.revision, requestId: crypto.randomUUID(), writes };
        }
        await executeDataCommand(command, env);
        if (phase === 'bodies') total.clearedBodies += command.writes.length; else total.deletedMetadata += command.writes.length;
        completed = true; break;
      } catch (e) { if (e instanceof DataError && e.code === 'DATA_CONFLICT') command = undefined; }
    }
    total.invalidRecords += invalid; total.morePending ||= more || !completed; if (!completed) total.failedPhases++;
  }
  return total;
}
