import { executeDataCommand } from './data.ts';
import { potentialPlatformWork } from '../../shared/platform-whatsapp-work-authorization.ts';
export async function hasPotentialPlatformWork(env: Parameters<typeof executeDataCommand>[1], now = Date.now()): Promise<boolean> {
  try {
    return await potentialPlatformWork(async path => {
      const result = await executeDataCommand({ action: 'read', read: { kind: 'document', path } }, env);
      if (!('documents' in result)) throw new Error('Invalid wake dependency');
      return result.documents[0]?.data;
    }, async (root, status) => {
      const result = await executeDataCommand({ action: 'read', read: { kind: 'query', path: root, filters: [{ field: 'status', op: '==', value: status }, ...root === 'platformWhatsAppJobs' ? [{ field: 'nextAttemptAt', op: '<=' as const, value: now }] : []], order: root === 'platformWhatsAppJobs' ? [{ field: 'nextAttemptAt', direction: 'asc' }] : [], limit: 1 } }, env);
      if (!('documents' in result)) throw new Error('Invalid wake candidates');
      return result.documents;
    }, { ...env }, now);
  } catch { return false; }
}
