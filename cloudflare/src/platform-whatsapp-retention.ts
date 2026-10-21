import type { DataCommand, DataWrite } from '../../shared/data-protocol.ts';
import { isPlatformWhatsAppConversationRecord, isPlatformWhatsAppEventRecord, isPlatformWhatsAppStoredEvent } from '../../shared/platform-whatsapp-records.ts';
import { DataError, executeDataCommand } from './data.ts';
import { isPlatformWhatsAppStoredLinkControl, isPlatformWhatsAppLinkUidRecord, LINK_UUID, type PlatformWhatsAppStoredLinkControl, type PlatformWhatsAppLinkUidRecord } from '../../shared/platform-whatsapp-link-records.ts';

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
  for (const collection of ['platformWhatsAppLinkChallenges', 'platformWhatsAppLinks'] as const) {
    const phase = await cleanupLinkPhase(env, collection, now, Math.min(batchLimit, 25));
    result.deletedMetadata += phase.changed; result.morePending ||= phase.morePending;
    invalidRecords += phase.invalidRecords; failedPhases += phase.failedPhases;
  }
  if (invalidRecords || failedPhases) console.warn({ event: 'platform_whatsapp_retention_incomplete', invalidRecords, failedPhases });
  return result;
}

const linkScopeEqual = (a: PlatformWhatsAppStoredLinkControl, b: PlatformWhatsAppStoredLinkControl) => a.wabaId === b.wabaId && a.phoneE164 === b.phoneE164 && a.phoneNumberId === b.phoneNumberId;
function validLinkPath(path: string, value: unknown): value is PlatformWhatsAppStoredLinkControl {
  if (!isPlatformWhatsAppStoredLinkControl(value)) return false;
  switch (value.recordType) {
    case 'link_uid': return path === 'platformWhatsAppLinks/uid_' + value.uidIndex;
    case 'link_phone': return path === 'platformWhatsAppLinks/phone_' + value.phoneIndex;
    case 'link_request': return path === 'platformWhatsAppLinkChallenges/request_' + value.requestDigest;
    case 'link_revoke_request': return path === 'platformWhatsAppLinkChallenges/revoke_' + value.requestDigest;
    case 'link': return path.startsWith('platformWhatsAppLinks/link_') && LINK_UUID.test(path.slice('platformWhatsAppLinks/link_'.length));
    case 'link_challenge': return path.startsWith('platformWhatsAppLinkChallenges/challenge_') && LINK_UUID.test(path.slice('platformWhatsAppLinkChallenges/challenge_'.length));
  }
}
/** No cursor exists in the private query contract. Corrupt rows are retained and
 * counted as incomplete; an explicit repair is needed if they fill the first page. */
async function cleanupLinkPhase(env: RetentionEnvironment, collection: 'platformWhatsAppLinks' | 'platformWhatsAppLinkChallenges', now: number, limit: number) {
  let command: Extract<DataCommand, { action: 'commit' }> | undefined;
  let invalidRecords = 0, morePending = false, changed = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (!command) {
        const selected = await executeDataCommand({ action: 'read', read: { kind: 'query', path: collection, filters: [{ field: 'expiresAt', op: '<=', value: now }], order: [{ field: 'expiresAt', direction: 'asc' }], limit } }, env);
        if (!('documents' in selected)) throw new Error('Unexpected cleanup result');
        const cache = new Map<string, PlatformWhatsAppStoredLinkControl | null>();
        const writes = new Map<string, DataWrite>(); invalidRecords = 0;
        async function read(path: string) {
          if (cache.has(path)) return cache.get(path)!;
          const result = await executeDataCommand({ action: 'read', read: { kind: 'document', path } }, env);
          if (!('documents' in result)) throw new Error('Unexpected cleanup result');
          if (result.revision !== selected.revision) throw new DataError(409, 'DATA_CONFLICT');
          const data = result.documents[0]?.data;
          if (data !== undefined && !validLinkPath(path, data)) throw new Error('Invalid link control');
          const value = data === undefined ? null : data as PlatformWhatsAppStoredLinkControl; cache.set(path, value); return value;
        }
        async function pruneOwner(owner: PlatformWhatsAppLinkUidRecord, staged: Map<string, DataWrite>) {
          const ownerPath = 'platformWhatsAppLinks/uid_' + owner.uidIndex;
          const linkPath = owner.currentLinkId ? 'platformWhatsAppLinks/link_' + owner.currentLinkId : null;
          const challengePath = owner.pendingChallengeId ? 'platformWhatsAppLinkChallenges/challenge_' + owner.pendingChallengeId : null;
          const link = linkPath ? await read(linkPath) : null, challenge = challengePath ? await read(challengePath) : null;
          if (linkPath && (!link || link.recordType !== 'link' || link.uidIndex !== owner.uidIndex || !linkScopeEqual(link, owner) || link.status !== 'active')) throw new Error('Invalid owner link');
          if (challengePath && (!challenge || challenge.recordType !== 'link_challenge' || challenge.uidIndex !== owner.uidIndex || !linkScopeEqual(challenge, owner) || !['pending', 'verified'].includes(challenge.status))) throw new Error('Invalid owner challenge');
          const originalDates = [...owner.issues.map(i => ({ createdAt: i.issuedAt, expiresAt: i.expiresAt })), ...link ? [link] : [], ...challenge && challenge.recordType === 'link_challenge' ? [{ createdAt: challenge.createdAt, expiresAt: challenge.validUntil }] : []];
          if (!originalDates.length || Math.max(...originalDates.map(d => d.createdAt)) !== owner.createdAt || Math.max(...originalDates.map(d => d.expiresAt)) !== owner.expiresAt) throw new Error('Invalid aggregate dates');
          if (link?.recordType === 'link') {
            const phonePath = 'platformWhatsAppLinks/phone_' + link.phoneIndex, phone = await read(phonePath);
            if (phone && (phone.recordType !== 'link_phone' || !linkScopeEqual(phone, owner))) throw new Error('Invalid owner phone');
            const matches = phone?.recordType === 'link_phone' && phone.uidIndex === owner.uidIndex && phone.linkId === owner.currentLinkId && phone.linkRevision === link.revision && phone.createdAt === link.createdAt && phone.expiresAt === link.expiresAt;
            if (phone?.recordType === 'link_phone' && phone.linkId === owner.currentLinkId && !matches) throw new Error('Invalid expired ownership');
            if (phone?.recordType === 'link_phone' && phone.linkId !== owner.currentLinkId) {
              const replacement = await read('platformWhatsAppLinks/link_' + phone.linkId), replacementOwner = await read('platformWhatsAppLinks/uid_' + phone.uidIndex);
              if (replacement?.recordType !== 'link' || replacementOwner?.recordType !== 'link_uid' || replacementOwner.currentLinkId !== phone.linkId || replacement.status !== 'active' || replacement.uidIndex !== phone.uidIndex || replacement.phoneIndex !== phone.phoneIndex || replacement.revision !== phone.linkRevision || replacement.createdAt !== phone.createdAt || replacement.expiresAt !== phone.expiresAt || !linkScopeEqual(replacement, owner) || !linkScopeEqual(replacementOwner, owner)) throw new Error('Invalid replacement ownership');
            }
            if (now < link.validUntil && !matches) throw new Error('Invalid live ownership');
            if (now >= link.validUntil && matches) staged.set(phonePath, { op: 'delete', path: phonePath });
          }
          const current = link?.recordType === 'link' && link.validUntil > now ? link : null, pending = challenge?.recordType === 'link_challenge' && challenge.validUntil > now ? challenge : null;
          const issues = owner.issues.filter(i => i.expiresAt > now);
          const dates = [...issues.map(i => ({ createdAt: i.issuedAt, expiresAt: i.expiresAt })), ...current ? [current] : [], ...pending ? [{ createdAt: pending.createdAt, expiresAt: pending.validUntil }] : []];
          if (!dates.length) { staged.set(ownerPath, { op: 'delete', path: ownerPath }); return; }
          const updated = { ...owner, currentLinkId: current ? owner.currentLinkId : null, pendingChallengeId: pending ? owner.pendingChallengeId : null, issues, createdAt: Math.max(...dates.map(d => d.createdAt)), expiresAt: Math.max(...dates.map(d => d.expiresAt)) };
          if (!isPlatformWhatsAppLinkUidRecord(updated)) throw new Error('Invalid pruned owner');
          if (JSON.stringify(owner) !== JSON.stringify(updated)) staged.set(ownerPath, { op: 'set', path: ownerPath, data: updated });
        }
        // Every entity is read completely before staging its bounded conditional writes.
        for (const { path, data } of [...selected.documents].sort((a, b) => Number(a.data.recordType !== 'link') - Number(b.data.recordType !== 'link'))) {
          if (!validLinkPath(path, data)) { invalidRecords++; continue; }
          cache.set(path, data);
          const staged = new Map<string, DataWrite>();
          try {
            if (data.recordType === 'link' || data.recordType === 'link_challenge' || data.recordType === 'link_phone') {
              const owner = await read('platformWhatsAppLinks/uid_' + data.uidIndex);
              if (owner && (owner.recordType !== 'link_uid' || !linkScopeEqual(owner, data))) throw new Error('Invalid referenced owner');
              if (owner?.recordType === 'link_uid') await pruneOwner(owner, staged);
              if (data.recordType === 'link') {
                const phonePath = 'platformWhatsAppLinks/phone_' + data.phoneIndex, phone = await read(phonePath);
                if (phone && (phone.recordType !== 'link_phone' || !linkScopeEqual(phone, data))) throw new Error('Invalid phone');
                if (phone?.recordType === 'link_phone' && phone.linkId === path.slice('platformWhatsAppLinks/link_'.length) && (phone.linkRevision !== data.revision || phone.uidIndex !== data.uidIndex || phone.expiresAt !== data.expiresAt || phone.createdAt !== data.createdAt)) throw new Error('Invalid orphan phone relationship');
                if (phone?.recordType === 'link_phone' && phone.linkId === path.slice('platformWhatsAppLinks/link_'.length) && phone.linkRevision === data.revision && phone.uidIndex === data.uidIndex && phone.expiresAt === data.expiresAt) staged.set(phonePath, { op: 'delete', path: phonePath });
              }
              if (data.recordType === 'link_phone') {
                const linked = await read('platformWhatsAppLinks/link_' + data.linkId);
                if (linked && (linked.recordType !== 'link' || !linkScopeEqual(linked, data) || linked.uidIndex !== data.uidIndex || linked.phoneIndex !== data.phoneIndex || linked.expiresAt !== data.expiresAt || linked.revision !== data.linkRevision)) throw new Error('Invalid phone link');
              }
            } else if (data.recordType === 'link_uid') await pruneOwner(data, staged);
            staged.set(path, { op: 'delete', path });
            for (const [key, write] of staged) writes.set(key, write);
          } catch (error) { if (error instanceof DataError) throw error; invalidRecords++; }
        }
        morePending = selected.documents.length === limit || invalidRecords > 0;
        if (!writes.size) return { changed: 0, morePending, invalidRecords, failedPhases: 0 };
        if (writes.size > 100) throw new Error('Cleanup write bound exceeded');
        changed = [...writes.values()].filter(w => w.op === 'delete').length;
        const priority = (path: string) => path.startsWith('platformWhatsAppLinkChallenges/') ? 0 : path.startsWith('platformWhatsAppLinks/link_') ? 1 : path.startsWith('platformWhatsAppLinks/phone_') ? 2 : 3;
        command = { action: 'commit', expectedRevision: selected.revision, requestId: crypto.randomUUID(), writes: [...writes.values()].sort((a, b) => priority(a.path) - priority(b.path)) };
      }
      await executeDataCommand(command, env); return { changed, morePending, invalidRecords, failedPhases: 0 };
    } catch (error) { if (error instanceof DataError && error.code === 'DATA_CONFLICT') command = undefined; }
  }
  return { changed: 0, morePending: true, invalidRecords, failedPhases: 1 };
}
