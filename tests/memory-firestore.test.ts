import { describe, expect, it } from 'vitest';
import { memoryFirestore } from './memoryFirestore';
describe('Firestore test adapter snapshots', () => {
  it('keeps exists and data stable after later writes and deletes', async () => {
    const { db } = memoryFirestore();
    const reference = db.collection('users').doc('snapshot');
    const missing = await reference.get();
    await reference.set({ value: 1 });
    expect(missing.exists).toBe(false); expect(missing.data()).toBeUndefined();
    const existing = await reference.get();
    await reference.set({ value: 2 }); await reference.delete();
    expect(existing.exists).toBe(true); expect(existing.data()).toEqual({ value: 1 });
    existing.data()!.value = 9;
    expect(existing.data()).toEqual({ value: 1 });
  });
  it('reads one consistent view per attempt and retries document version conflicts', async () => {
    const { db } = memoryFirestore({ 'users/first': { value: 1 }, 'users/second': { value: 1 } });
    const first = db.collection('users').doc('first'), second = db.collection('users').doc('second');
    const pairs: number[][] = [];
    await db.runTransaction(async transaction => {
      const a = await transaction.get(first);
      if (!pairs.length) { await first.set({ value: 2 }); await second.set({ value: 2 }); }
      const b = await transaction.get(second);
      pairs.push([a.data()!.value, b.data()!.value]);
      transaction.set(db.collection('users').doc('result'), { value: a.data()!.value + b.data()!.value });
    });
    expect(pairs).toEqual([[1, 1], [2, 2]]);
    expect((await db.collection('users').doc('result').get()).data()).toEqual({ value: 4 });
  });
});

describe('Firestore test adapter compound queries', () => {
  it('keeps primary order with ordinal ASCII ties and path fallback', async () => {
    const { db } = memoryFirestore({
      'items/late': { startAt: 1, id: 'z' }, 'items/Z': { startAt: 2, id: 'Z' },
      'items/a': { startAt: 2, id: 'a' }, 'items/dash': { startAt: 2, id: '-a' },
      'items/A': { startAt: 2, id: 'A' }, 'items/under': { startAt: 2, id: '_a' },
      'items/duplicate-2': { startAt: 3, id: 'same' }, 'items/duplicate-1': { startAt: 3, id: 'same' },
    });
    const snapshot = await db.collection('items').orderBy('startAt', 'desc').orderBy('id', 'asc').get();
    expect(snapshot.docs.map(doc => doc.id)).toEqual(['duplicate-1', 'duplicate-2', 'dash', 'A', 'Z', 'under', 'a', 'late']);
  });
  it('uses nested lookup for ordering and range comparisons and excludes absent ordered fields', async () => {
    const { db } = memoryFirestore({
      'items/a': { client: { uid: 'A' }, startAt: 2 }, 'items/z': { client: { uid: 'Z' }, startAt: 2 },
      'items/lower': { client: { uid: 'a' }, startAt: 2 }, 'items/missing': { startAt: 2 },
      'items/missing-time': { client: { uid: 'B' } },
    });
    const snapshot = await db.collection('items').where('client.uid', '>', 'A').orderBy('startAt', 'desc').orderBy('client.uid').get();
    expect(snapshot.docs.map(doc => doc.id)).toEqual(['z', 'lower']);
    const nested = await db.collection('items').orderBy('client.uid', 'desc').get();
    expect(nested.docs.map(doc => doc.id)).toEqual(['lower', 'z', 'missing-time', 'a']);
  });
});
