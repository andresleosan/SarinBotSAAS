import type { VaultBackup, VaultThread } from '@/types/vault';
import { MAX_BACKUP_BYTES, vaultBackupSchema, vaultThreadSchema } from './schema';

const STORE = 'threads';
const METADATA = 'metadata';
const MAX_THREADS = 200;
const MAX_THREAD_BYTES = 10 * 1024 * 1024;
const MAX_CONTENT_BYTES = MAX_BACKUP_BYTES - 1024; // Reserve the JSON envelope and array delimiters.
interface Usage { bytes: number; count: number }
const byteSize = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
function threadSize(thread: VaultThread): number {
  const bytes = byteSize(thread);
  if (bytes > MAX_THREAD_BYTES) throw new Error('Esta conversación supera 10 MB. Crea una nueva conversación.');
  return bytes;
}
/** A separate database for each authenticated administrator; private content never uses Firestore. */
export class VaultDatabase {
  private connection: Promise<IDBDatabase> | undefined;
  private readonly name: string;
  constructor(ownerUid: string) {
    if (!ownerUid || ownerUid.length > 128) throw new Error('La cuenta no es válida.');
    this.name = `sarin-vault-v1:${encodeURIComponent(ownerUid)}`;
  }
  private open(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) return Promise.reject(new Error('Este navegador no permite guardar la bóveda. Activa el almacenamiento local.'));
    if (!this.connection) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
      let failed = false;
      const request = indexedDB.open(this.name, 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        if (!db.objectStoreNames.contains(METADATA)) {
          const metadata = db.createObjectStore(METADATA);
          const cursor = request.transaction!.objectStore(STORE).openCursor();
          const usage: Usage = { bytes: 0, count: 0 };
          cursor.onsuccess = () => {
            const item = cursor.result;
            if (item) { usage.bytes += byteSize(item.value); usage.count++; item.continue(); }
            else metadata.put(usage, 'total');
          };
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (failed) { database.close(); return; }
        database.onversionchange = () => { database.close(); this.connection = undefined; };
        resolve(database);
      };
      request.onerror = () => { failed = true; reject(new Error('No se pudo abrir la bóveda local.')); };
      request.onblocked = () => { failed = true; reject(new Error('Cierra las otras pestañas de Sarin Vault y vuelve a intentar.')); };
      });
      this.connection = opening;
      void opening.catch(() => { if (this.connection === opening) this.connection = undefined; });
    }
    return this.connection;
  }
  private async write(operation: (store: IDBObjectStore, metadata: IDBObjectStore, fail: (message: string) => void) => void): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE, METADATA], 'readwrite');
      let reason: Error | undefined;
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error('No se pudo guardar la bóveda. Revisa el espacio disponible.'));
      transaction.onabort = () => reject(reason ?? new Error('No se guardaron los cambios. La bóveda anterior sigue intacta.'));
      const fail = (message: string) => { reason = new Error(message); transaction.abort(); };
      try { operation(transaction.objectStore(STORE), transaction.objectStore(METADATA), fail); }
      catch (error) { transaction.abort(); reject(error); }
    });
  }
  async listThreads(): Promise<VaultThread[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).getAll();
      transaction.oncomplete = () => {
        try { resolve((request.result as unknown[]).map(value => vaultThreadSchema.parse(value)).sort((a, b) => b.updatedAt - a.updatedAt)); }
        catch { reject(new Error('Hay datos locales dañados. Conserva una copia antes de borrar la bóveda.')); }
      };
      transaction.onerror = () => reject(new Error('No se pudo leer la bóveda.'));
      transaction.onabort = () => reject(new Error('Se interrumpió la lectura de la bóveda. Vuelve a abrirla.'));
    });
  }
  async saveThread(value: VaultThread): Promise<void> {
    const thread = vaultThreadSchema.parse(value);
    const bytes = threadSize(thread);
    await this.write((store, metadata, fail) => {
      const old = store.get(thread.id);
      old.onsuccess = () => {
        const request = metadata.get('total');
        request.onsuccess = () => {
          const usage = request.result as Usage;
          const next = { bytes: usage.bytes - (old.result ? byteSize(old.result) : 0) + bytes, count: usage.count + (old.result ? 0 : 1) };
          if (next.count > MAX_THREADS) { fail('La bóveda admite hasta 200 conversaciones. Exporta y elimina algunas para continuar.'); return; }
          if (next.bytes > MAX_CONTENT_BYTES) { fail('La bóveda supera 50 MB. Exporta y elimina algunas conversaciones para continuar.'); return; }
          store.put(thread); metadata.put(next, 'total');
        };
      };
    });
  }
  async deleteThread(threadId: string): Promise<void> {
    await this.write((store, metadata) => {
      const old = store.get(threadId);
      old.onsuccess = () => {
        if (!old.result) return;
        const request = metadata.get('total');
        request.onsuccess = () => {
          const usage = request.result as Usage;
          store.delete(threadId); metadata.put({ bytes: Math.max(0, usage.bytes - byteSize(old.result)), count: Math.max(0, usage.count - 1) }, 'total');
        };
      };
    });
  }
  async clear(): Promise<void> { await this.write((store, metadata) => { store.clear(); metadata.put({ bytes: 0, count: 0 }, 'total'); }); }
  async exportBackup(): Promise<VaultBackup> {
    return { format: 'sarin-vault', version: 1, exportedAt: new Date().toISOString(), threads: await this.listThreads() };
  }
  async importBackup(value: unknown): Promise<void> {
    // Validate everything before starting the single transaction. Imports only add new IDs.
    const backup = vaultBackupSchema.parse(value);
    for (const thread of backup.threads) threadSize(thread);
    const threads: VaultThread[] = backup.threads.map(thread => ({
      ...thread, id: crypto.randomUUID(),
      messages: thread.messages.map(message => ({ ...message, id: crypto.randomUUID(), attachments: message.attachments.map(attachment => ({ ...attachment, id: crypto.randomUUID() })) })),
      entries: thread.entries.map(entry => ({ ...entry, id: crypto.randomUUID() })),
      reminders: thread.reminders.map(reminder => ({ ...reminder, id: crypto.randomUUID() })),
    }));
    const importedBytes = threads.reduce((total, thread) => total + threadSize(thread), 0);
    await this.write((store, metadata, fail) => {
      const request = metadata.get('total');
      request.onsuccess = () => {
        const usage = request.result as Usage;
        if (usage.count + threads.length > MAX_THREADS) { fail('La importación supera el límite de 200 conversaciones. No se importó ningún dato.'); return; }
        if (usage.bytes + importedBytes > MAX_CONTENT_BYTES) { fail('La importación supera el límite de 50 MB. No se importó ningún dato.'); return; }
        for (const thread of threads) store.add(thread);
        metadata.put({ bytes: usage.bytes + importedBytes, count: usage.count + threads.length }, 'total');
      };
    });
  }
  close(): void {
    if (this.connection) { void this.connection.then(db => db.close()).catch(() => {}); this.connection = undefined; }
  }
}
