import type { DataFilter } from '../../../shared/data-protocol';

// Document values are validated as JSON by the storage boundary. The index
// signature matches the existing domain readers while allowing either backend.
export type DocumentData = Record<string, any>;
export interface DocumentSnapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): DocumentData | undefined;
  get(field: string): unknown;
}
export interface QueryDocumentSnapshot extends DocumentSnapshot {
  data(): DocumentData;
}
export interface QuerySnapshot {
  readonly docs: QueryDocumentSnapshot[];
  readonly empty: boolean;
  readonly size: number;
}
export interface Query {
  where(field: string, op: DataFilter['op'], value: DataFilter['value']): Query;
  orderBy(field: string, direction?: 'asc' | 'desc'): Query;
  limit(count: number): Query;
  get(): Promise<QuerySnapshot>;
}
export interface CollectionReference extends Query {
  doc(id: string): DocumentReference;
}
export interface DocumentReference {
  readonly path: string;
  readonly id: string;
  collection(name: string): CollectionReference;
  get(): Promise<DocumentSnapshot>;
  set(data: object, options?: { merge?: boolean }): Promise<unknown>;
  delete(): Promise<unknown>;
}
export interface Transaction {
  get(target: DocumentReference): Promise<DocumentSnapshot>;
  get(target: Query): Promise<QuerySnapshot>;
  set(target: DocumentReference, data: object, options?: { merge?: boolean }): unknown;
  create(target: DocumentReference, data: object): unknown;
  delete(target: DocumentReference): unknown;
}
export interface Database {
  collection(name: string): CollectionReference;
  runTransaction<T>(handler: (transaction: Transaction) => Promise<T>, options?: { maxAttempts?: number }): Promise<T>;
}
