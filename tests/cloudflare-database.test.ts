import { describe, expect, it } from 'vitest';
import { createCloudflareDatabase, StorageError } from '../src/lib/storage/database';
import type { DataCommand, DataReadResult, DataCommitResult } from '../shared/data-protocol';

function storage() {
  let revision = 0;
  const rows = new Map<string, Record<string, unknown>>();
  const commits = new Map<string, number>();
  const seen: DataCommand[] = [];
  let loseResponse = false;
  const transport = async (command: DataCommand): Promise<DataReadResult | DataCommitResult> => {
    seen.push(structuredClone(command));
    if (command.action === 'read') {
      const { read } = command;
      const paths = [...rows.keys()].filter(path => read.kind === 'document' ? path === read.path : path.startsWith(read.path + '/') && path.split('/').length === read.path.split('/').length + 1);
      return { revision, documents: paths.map(path => ({ path, data: structuredClone(rows.get(path)!) })) };
    }
    if (commits.has(command.requestId)) return { revision: commits.get(command.requestId)! };
    if (command.expectedRevision !== revision) throw new StorageError(409, 'DATA_CONFLICT');
    for (const write of command.writes) {
      if (write.op === 'delete') rows.delete(write.path);
      else rows.set(write.path, write.merge ? { ...rows.get(write.path), ...structuredClone(write.data) } : structuredClone(write.data));
    }
    commits.set(command.requestId, ++revision);
    if (loseResponse) { loseResponse = false; throw new TypeError('transport lost after durable commit'); }
    return { revision };
  };
  return { rows, seen, transport, externalWrite: (path: string, data: Record<string, unknown>) => { rows.set(path, data); revision++; }, loseNextResponse: () => { loseResponse = true; } };
}

describe('Cloudflare data adapter', () => {
  it('accepts private invitation documents through the storage protocol', async () => {
    const store = storage(), db = createCloudflareDatabase(store.transport);
    await db.collection('invitations').doc('a'.repeat(24)).set({ id: 'a'.repeat(24), state: 'issued' });
    expect((await db.collection('invitations').doc('a'.repeat(24)).get()).exists).toBe(true);
  });
  it('reads documents and passes scoped queries without translating them into client-side filters', async () => {
    const store = storage();
    store.externalWrite('businesses/shop', { name: 'Taller' });
    const db = createCloudflareDatabase(store.transport);
    expect(await db.collection('businesses').doc('shop').get()).toMatchObject({ exists: true, id: 'shop' });
    expect((await db.collection('businesses').doc('missing').get()).data()).toBeUndefined();
    await db.collection('businesses').doc('shop').collection('appointments').where('client.uid', '==', 'alice').orderBy('startAt', 'desc').limit(20).get();
    expect(store.seen.at(-1)).toEqual({ action: 'read', read: { kind: 'query', path: 'businesses/shop/appointments', filters: [{ field: 'client.uid', op: '==', value: 'alice' }], order: [{ field: 'startAt', direction: 'desc' }], limit: 20 } });
  });

  it('retries a transaction after a query phantom and commits only the recomputed result', async () => {
    const store = storage(), db = createCloudflareDatabase(store.transport);
    let attempts = 0;
    await db.runTransaction(async tx => {
      const found = await tx.get(db.collection('businesses').doc('shop').collection('appointments'));
      if (++attempts === 1) store.externalWrite('businesses/shop/appointments/other', { booked: true });
      tx.set(db.collection('users').doc('counter'), { count: found.size });
    });
    expect(attempts).toBe(2);
    expect(store.rows.get('users/counter')).toEqual({ count: 1 });
  });

  it('rejects mixed snapshot revisions before running any durable write', async () => {
    const store = storage(), db = createCloudflareDatabase(store.transport);
    let attempts = 0;
    const result = await db.runTransaction(async tx => {
      await tx.get(db.collection('users').doc('first'));
      if (++attempts === 1) store.externalWrite('users/second', { value: 2 });
      const second = await tx.get(db.collection('users').doc('second'));
      tx.set(db.collection('users').doc('result'), second.data() ?? {});
      return second.exists;
    });
    expect(result).toBe(true);
    expect(attempts).toBe(2);
    expect(store.seen.filter(command => command.action === 'commit')).toHaveLength(1);
  });

  it('resolves a lost commit response with the same UUID and never reruns the callback', async () => {
    const store = storage(), db = createCloudflareDatabase(store.transport);
    let callbacks = 0;
    store.loseNextResponse();
    await db.runTransaction(async tx => { callbacks++; tx.create(db.collection('users').doc('one'), { count: 1 }); });
    const commits = store.seen.filter(command => command.action === 'commit');
    expect(callbacks).toBe(1);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual(commits[1]);
    expect(store.rows.size).toBe(1);
  });

  it('writes merge metadata and deletes without leaking caller mutations into the staged payload', async () => {
    const store = storage(), db = createCloudflareDatabase(store.transport);
    const ref = db.collection('users').doc('alice');
    await ref.set({ name: 'Ana', role: 'user' });
    const value = { name: 'Alicia', optional: null };
    await db.runTransaction(async tx => { tx.set(ref, value, { merge: true }); value.name = 'mutated later'; });
    expect(store.rows.get('users/alice')).toEqual({ name: 'Alicia', role: 'user', optional: null });
    await ref.delete();
    expect((await ref.get()).exists).toBe(false);
  });

  it('rejects invalid paths, non-JSON values and foreign references before transport', async () => {
    const store = storage(), db = createCloudflareDatabase(store.transport);
    expect(() => db.collection('users/other')).toThrow();
    expect(() => db.collection('users').doc('../other')).toThrow();
    await expect(db.collection('users').doc('one').set({ value: Infinity })).rejects.toThrow();
    await expect(db.collection('users').doc('one').set({ value: undefined })).rejects.toThrow();
    await expect(db.runTransaction(async tx => { await tx.get(createCloudflareDatabase(store.transport).collection('users').doc('one')); })).rejects.toThrow();
    expect(store.rows.size).toBe(0);
  });

  it('does not hide a non-conflict storage error by rerunning business logic', async () => {
    let calls = 0;
    const db = createCloudflareDatabase(async command => { if (command.action === 'read') return { revision: 0, documents: [] }; throw new StorageError(409, 'DATA_EXISTS'); });
    await expect(db.runTransaction(async tx => { calls++; tx.create(db.collection('users').doc('alice'), {}); })).rejects.toMatchObject({ code: 'DATA_EXISTS' });
    expect(calls).toBe(1);
  });
});
