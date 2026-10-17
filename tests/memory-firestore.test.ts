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
