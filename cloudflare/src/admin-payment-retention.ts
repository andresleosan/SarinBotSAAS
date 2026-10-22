import type { DataCommand, DataWrite } from '../../shared/data-protocol.ts';
import { isAdminPaymentRecord } from '../../shared/admin-payment-actions.ts';
import { DataError, executeDataCommand } from './data.ts';

/** Bounded cleanup runs independently of WhatsApp and never selects the stable key marker. */
export async function cleanupAdminPaymentRetention(env: Parameters<typeof executeDataCommand>[1], now = Date.now(), limit = 50) {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('Invalid retention options');
  const result = { clearedBodies: 0, deletedMetadata: 0, morePending: false, invalidRecords: 0, failedPhases: 0 };
  for (const body of [true, false]) {
    let command: Extract<DataCommand, { action: 'commit' }> | undefined;
    let completed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!command) {
          const field = body ? 'bodyExpiresAt' : 'expiresAt';
          const selected = await executeDataCommand({ action: 'read', read: { kind: 'query', path: 'adminPaymentActions', filters: [...(body ? [{ field: 'state', op: '==' as const, value: 'pending' }] : []), { field, op: '<=', value: now }], order: [{ field, direction: 'asc' }], limit } }, env);
          if (!('documents' in selected)) throw new Error('Invalid retention result');
          const writes: DataWrite[] = [];
          result.morePending ||= selected.documents.length === limit;
          for (const { path, data } of selected.documents) {
            if (!isAdminPaymentRecord(path, data) || data.recordType === 'key_marker' || body && data.recordType !== 'proposal') { result.invalidRecords++; result.morePending = true; continue; }
            writes.push(body ? { op: 'set', path, data: { ...data, state: 'expired', reason: null } } : { op: 'delete', path });
          }
          if (!writes.length) { completed = true; break; }
          command = { action: 'commit', expectedRevision: selected.revision, requestId: crypto.randomUUID(), writes };
        }
        await executeDataCommand(command, env);
        result[body ? 'clearedBodies' : 'deletedMetadata'] += command.writes.length;
        completed = true; break;
      } catch (error) { if (error instanceof DataError && error.code === 'DATA_CONFLICT') command = undefined; }
    }
    if (!completed) { result.failedPhases++; result.morePending = true; }
  }
  return result;
}
