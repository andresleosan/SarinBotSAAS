import { isWorkRecordAtPath, type WorkRecord } from '../../shared/platform-whatsapp-work.ts';
import type { DataCommand, DataWrite } from '../../shared/data-protocol.ts';
import { DataError, executeDataCommand } from './data.ts';

type Env = Parameters<typeof executeDataCommand>[1];
const roots = ['platformWhatsAppJobs', 'platformWhatsAppOutbox', 'platformWhatsAppBudgetCalls', 'platformWhatsAppBudgetPeriods'] as const;
/** All conditional reference changes share the selected page's revision and journal. */
export async function cleanupPlatformWorkPhase(env: Env, root: typeof roots[number], bodies: boolean, now: number, limit: number) {
  let command: Extract<DataCommand, { action: 'commit' }> | undefined;
  let changed = 0, invalidRecords = 0, morePending = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!command) {
        const field = bodies ? 'bodyExpiresAt' : 'expiresAt';
        const selected = await executeDataCommand({ action: 'read', read: { kind: 'query', path: root, filters: [...bodies ? [{ field: 'bodyState', op: '==' as const, value: 'body_present' }] : [], { field, op: '<=', value: now }], order: [{ field, direction: 'asc' }], limit } }, env);
        if (!('documents' in selected)) throw new Error('Invalid work cleanup read');
        const writes = new Map<string, DataWrite>(), cache = new Map<string, WorkRecord | null>();
        invalidRecords = 0; changed = 0;
        const read = async (path: string): Promise<WorkRecord | null> => {
          if (cache.has(path)) return cache.get(path)!;
          const result = await executeDataCommand({ action: 'read', read: { kind: 'document', path } }, env);
          if (!('documents' in result)) throw new Error('Invalid work cleanup read');
          if (result.revision !== selected.revision) throw new DataError(409, 'DATA_CONFLICT');
          const data = result.documents[0]?.data;
          if (data !== undefined && !isWorkRecordAtPath(path, data)) throw new Error('Invalid work cleanup dependency');
          const value = data as WorkRecord | undefined ?? null; cache.set(path, value); return value;
        };
        for (const { path, data } of selected.documents) {
          if (!isWorkRecordAtPath(path, data)) { invalidRecords++; continue; }
          if (changed === 20) continue;
          try {
            const staged = new Map<string, DataWrite>();
            if (bodies) {
              if ((data.recordType !== 'job' && data.recordType !== 'outbox') || data.bodyState !== 'body_present' || data.bodyExpiresAt > now) throw new Error('Invalid body selection');
              staged.set(path, { op: 'set', path, data: { ...data, bodyState: 'body_erased', content: null } });
            } else {
              if (data.recordType === 'provider_alias') {
                const bytes = new TextEncoder().encode(JSON.stringify(['sarin/platform-whatsapp', 1, 'provider-alias', data.wabaId, data.phoneE164, data.phoneNumberId, data.providerId]));
                const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
                if (path !== 'platformWhatsAppOutbox/provider_' + digest) throw new Error('Invalid provider alias path');
                const target = await read('platformWhatsAppOutbox/' + data.outboxId);
                if (target && (target.recordType !== 'outbox' || target.providerId !== data.providerId || target.jobId !== data.jobId || target.epoch !== data.epoch || target.expiresAt !== data.expiresAt || target.wabaId !== data.wabaId || target.phoneE164 !== data.phoneE164 || target.phoneNumberId !== data.phoneNumberId)) throw new Error('Invalid provider alias target');
              }
              if (data.expiresAt > now) throw new Error('Invalid expiry selection');
              if (data.recordType === 'job' || data.recordType === 'outbox') {
                const hp = 'platformWhatsAppJobs/head_' + data.conversationId, head = await read(hp);
                if (head && head.recordType !== 'control_head') throw new Error('Invalid work head');
                if (head?.recordType === 'control_head' && head.controlEpoch === data.controlEpoch && head.controlRevision === data.controlRevision) {
                  if (data.recordType === 'outbox' && head.currentMenuOutboxId === data.outboxId) staged.set(hp, { op: 'set', path: hp, data: { ...head, currentMenuOutboxId: null } });
                  if (data.recordType === 'job') {
                    if (head.headJobId === data.jobId) {
                      const next = data.nextJobId ? await read('platformWhatsAppJobs/' + data.nextJobId) : null;
                      if (data.nextJobId && (next?.recordType !== 'job' || next.conversationId !== data.conversationId || next.controlEpoch !== data.controlEpoch || next.controlRevision !== data.controlRevision)) throw new Error('Broken work edge');
                      staged.set(hp, { op: 'set', path: hp, data: next?.recordType === 'job' ? { ...head, headJobId: next.jobId, status: 'advance', nextAttemptAt: now } : { ...head, headJobId: null, tailJobId: null, status: 'idle', nextAttemptAt: null } });
                    } else if (head.headJobId !== null && data.status === 'waiting') {
                      // A predecessor owns this edge; let bounded head advancement unlink it.
                      invalidRecords++; continue;
                    }
                  }
                }
              }
              staged.set(path, { op: 'delete', path });
            }
            for (const [p, w] of staged) {
              if (w.op !== 'delete' && !isWorkRecordAtPath(p, w.data)) throw new Error('Invalid work cleanup write');
              // Two selected entities may share a head. Do not overwrite an earlier transition.
              if (writes.has(p) && p !== path) throw new Error('Dependent work cleanup continuation');
            }
            for (const [p, w] of staged) writes.set(p, w);
            changed++;
          } catch (e) { if (e instanceof DataError) throw e; invalidRecords++; }
        }
        morePending = selected.documents.length >= Math.min(limit, 20) || invalidRecords > 0;
        if (!writes.size) return { changed: 0, invalidRecords, morePending, failedPhases: 0 };
        if (writes.size > 100) throw new Error('Work cleanup exceeds write budget');
        command = { action: 'commit', expectedRevision: selected.revision, requestId: crypto.randomUUID(), writes: [...writes.values()] };
      }
      await executeDataCommand(command, env);
      return { changed, invalidRecords, morePending, failedPhases: 0 };
    } catch (e) { if (e instanceof DataError && e.code === 'DATA_CONFLICT') command = undefined; }
  }
  return { changed: 0, invalidRecords, morePending: true, failedPhases: 1 };
}
export async function cleanupPlatformWorkRetention(env: Env, now: number, limit: number) {
  const total = { clearedBodies: 0, deletedMetadata: 0, invalidRecords: 0, morePending: false, failedPhases: 0 };
  for (const bodies of [true, false]) for (const root of roots) {
    if (bodies && root !== 'platformWhatsAppJobs' && root !== 'platformWhatsAppOutbox') continue;
    const result = await cleanupPlatformWorkPhase(env, root, bodies, now, limit);
    if (bodies) total.clearedBodies += result.changed; else total.deletedMetadata += result.changed;
    total.invalidRecords += result.invalidRecords; total.failedPhases += result.failedPhases; total.morePending ||= result.morePending;
  }
  return total;
}
