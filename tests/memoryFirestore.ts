import type { Firestore } from 'firebase-admin/firestore';

type Data = Record<string, unknown>;
type Snapshot = { exists: boolean; id: string; data: () => Data | undefined };
const copy = <T>(value: T): T => structuredClone(value);

// Firestore is the external boundary. This optimistic in-memory adapter tracks
// document versions, deliberately not query phantoms. Concurrent empty queries
// therefore double-book unless production also writes a shared resource lock.
export function memoryFirestore(initial: Record<string, Data> = {}) {
  const rows = new Map(Object.entries(initial).map(([path, value]) => [path, { version: 1, data: copy(value) }]));
  const read = (path: string): Snapshot => ({ exists: rows.has(path), id: path.split('/').at(-1)!, data: () => copy(rows.get(path)?.data) });
  class Reference {
    constructor(public readonly path: string) {}
    get id() { return this.path.split('/').at(-1)!; }
    collection(name: string) { return new Query(`${this.path}/${name}`); }
    async get() { return read(this.path); }
    async set(data: Data, options?: { merge?: boolean }) { write(this.path, data, options?.merge); }
  }
  class Query {
    constructor(public readonly path: string, public readonly filters: [string, unknown][] = [], public readonly cap = Infinity) {}
    doc(id: string) { return new Reference(`${this.path}/${id}`); }
    where(field: string, _operator: string, value: unknown) { return new Query(this.path, [...this.filters, [field, value]], this.cap); }
    limit(cap: number) { return new Query(this.path, this.filters, cap); }
    orderBy(_field: string, _direction?: string) { return this; }
    async get() {
      const docs = [...rows.keys()].filter((path) => path.startsWith(`${this.path}/`) && path.slice(this.path.length + 1).split('/').length === 1).filter((path) => this.filters.every(([field, value]) => {
        const data = rows.get(path)!.data;
        const nested = field.split('.').reduce<unknown>((current, key) => current && typeof current === 'object' ? (current as Data)[key] : undefined, data);
        return nested === value;
      })).slice(0, this.cap).map(read);
      return { docs, empty: docs.length === 0, size: docs.length };
    }
  }
  function write(path: string, data: Data, merge = false) {
    const previous = rows.get(path);
    rows.set(path, { version: (previous?.version ?? 0) + 1, data: merge ? { ...previous?.data, ...copy(data) } : copy(data) });
  }
  const adapter = {
    collection: (name: string) => new Query(name),
    runTransaction: async <T>(handler: (transaction: unknown) => Promise<T>) => {
      for (let attempt = 0; attempt < 10; attempt++) {
        const reads = new Map<string, number>();
        const writes: { path: string; data: Data; merge?: boolean; create?: boolean }[] = [];
        const transaction = {
          get: async (target: Reference | Query) => {
            if (target instanceof Reference) {
              reads.set(target.path, rows.get(target.path)?.version ?? 0);
              return read(target.path);
            }
            const result = await target.get();
            for (const document of result.docs) {
              const path = `${target.path}/${document.id}`;
              reads.set(path, rows.get(path)?.version ?? 0);
            }
            return result;
          },
          set: (reference: Reference, data: Data, options?: { merge?: boolean }) => { writes.push({ path: reference.path, data, merge: options?.merge }); },
          update: (reference: Reference, data: Data) => { writes.push({ path: reference.path, data, merge: true }); },
          create: (reference: Reference, data: Data) => { writes.push({ path: reference.path, data, create: true }); },
        };
        const value = await handler(transaction);
        if ([...reads].some(([path, version]) => (rows.get(path)?.version ?? 0) !== version)) continue;
        if (writes.some((item) => item.create && rows.has(item.path))) throw new Error('Document exists');
        for (const item of writes) write(item.path, item.data, item.merge);
        return value;
      }
      throw new Error('Transaction retry limit');
    },
  };
  return { db: adapter as unknown as Firestore, rows };
}
