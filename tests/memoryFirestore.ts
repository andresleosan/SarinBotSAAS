import type { Firestore } from 'firebase-admin/firestore';

type Data = Record<string, unknown>;
type Snapshot = { exists: boolean; id: string; data: () => Data | undefined };
const copy = <T>(value: T): T => structuredClone(value);
const nestedValue = (data: Data, field: string) => field.split('.').reduce<unknown>((current, key) =>
  current && typeof current === 'object' ? (current as Data)[key] : undefined, data);
const ordinal = (first: string, second: string) => first < second ? -1 : first > second ? 1 : 0;

// Firestore is the external boundary. This optimistic in-memory adapter tracks
// document versions, deliberately not query phantoms. Concurrent empty queries
// therefore double-book unless production also writes a shared resource lock.
export function memoryFirestore(initial: Record<string, Data> = {}) {
  const rows = new Map(Object.entries(initial).map(([path, value]) => [path, { version: 1, data: copy(value) }]));
  const read = (path: string, source = rows): Snapshot => {
    const data = copy(source.get(path)?.data);
    return { exists: source.has(path), id: path.split('/').at(-1)!, data: () => copy(data) };
  };
  class Reference {
    constructor(public readonly path: string) {}
    get id() { return this.path.split('/').at(-1)!; }
    collection(name: string) { return new Query(`${this.path}/${name}`); }
    async get() { return read(this.path); }
    async set(data: Data, options?: { merge?: boolean }) { write(this.path, data, options?.merge); }
    async delete() { rows.delete(this.path); }
  }
  class Query {
    constructor(public readonly path: string, public readonly filters: [string, string, unknown][] = [], public readonly cap = Infinity, public readonly ordering: [string, string][] = []) {}
    doc(id: string) { return new Reference(`${this.path}/${id}`); }
    where(field: string, operator: string, value: unknown) { return new Query(this.path, [...this.filters, [field, operator, value]], this.cap, this.ordering); }
    limit(cap: number) { return new Query(this.path, this.filters, cap, this.ordering); }
    orderBy(field: string, direction = 'asc') { return new Query(this.path, this.filters, this.cap, [...this.ordering, [field, direction]]); }
    async get(source = rows) {
      const paths = [...source.keys()].filter((path) => path.startsWith(`${this.path}/`) && path.slice(this.path.length + 1).split('/').length === 1).filter((path) => this.filters.every(([field, operator, value]) => {
        const data = source.get(path)!.data;
        const nested = nestedValue(data, field);
        if (nested === undefined) return false;
        if (operator === '==') return nested === value;
        const comparison = typeof nested === 'number' && typeof value === 'number' ? nested - value : typeof nested === 'string' && typeof value === 'string' ? ordinal(nested, value) : null;
        if (comparison === null) throw new Error('Unsupported fixture comparison');
        if (operator === '<=') return comparison <= 0;
        if (operator === '>') return comparison > 0;
        if (operator === '<') return comparison < 0;
        if (operator === '>=') return comparison >= 0;
        throw new Error('Unsupported fixture operator');
      }));
      const orderedPaths = paths.filter(path => this.ordering.every(([field]) => nestedValue(source.get(path)!.data, field) !== undefined));
      if (this.ordering.length) {
        orderedPaths.sort((a, b) => {
          for (const [field, direction] of this.ordering) {
            const first = nestedValue(source.get(a)!.data, field), second = nestedValue(source.get(b)!.data, field);
            const comparison = typeof first === 'number' && typeof second === 'number' ? first - second : ordinal(String(first), String(second));
            if (comparison !== 0) return direction === 'desc' ? -comparison : comparison;
          }
          return ordinal(a, b);
        });
      }
      const docs = orderedPaths.slice(0, this.cap).map(path => read(path, source));
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
        const view = new Map(rows);
        const reads = new Map<string, number>();
        const writes: { path: string; data?: Data; merge?: boolean; create?: boolean; deleted?: boolean }[] = [];
        const transaction = {
          get: async (target: Reference | Query) => {
            if (target instanceof Reference) {
              reads.set(target.path, view.get(target.path)?.version ?? 0);
              return read(target.path, view);
            }
            const result = await target.get(view);
            for (const document of result.docs) {
              const path = `${target.path}/${document.id}`;
              reads.set(path, view.get(path)?.version ?? 0);
            }
            return result;
          },
          set: (reference: Reference, data: Data, options?: { merge?: boolean }) => { writes.push({ path: reference.path, data, merge: options?.merge }); },
          update: (reference: Reference, data: Data) => { writes.push({ path: reference.path, data, merge: true }); },
          create: (reference: Reference, data: Data) => { writes.push({ path: reference.path, data, create: true }); },
          delete: (reference: Reference) => { writes.push({ path: reference.path, deleted: true }); },
        };
        const value = await handler(transaction);
        if ([...reads].some(([path, version]) => (rows.get(path)?.version ?? 0) !== version)) continue;
        if (writes.some((item) => item.create && rows.has(item.path))) throw new Error('Document exists');
        for (const item of writes) {
          if (item.deleted) rows.delete(item.path);
          else write(item.path, item.data!, item.merge);
        }
        return value;
      }
      throw new Error('Transaction retry limit');
    },
  };
  return { db: adapter as unknown as Firestore, rows };
}
