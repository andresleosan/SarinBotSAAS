import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { VaultDatabase } from '../src/lib/vault/localDb';
import { decodeVaultBackup, encodeVaultBackup } from '../src/lib/vault/exportCrypto';
import { vaultBackupSchema, vaultChatRequestSchema } from '../src/lib/vault/schema';
import { calculateFinancialTotals } from '../src/lib/vault/finance';

const backup = {
  format: 'sarin-vault' as const, version: 1 as const, exportedAt: '2030-01-01T00:00:00.000Z',
  threads: [{ id: 'thread-1', title: 'Servicios', createdAt: 1000, updatedAt: 2000,
    messages: [{ id: 'message-1', role: 'user' as const, content: 'Factura privada', createdAt: 1000, attachments: [] }],
    entries: [{ id: 'entry-1', description: 'Agua', amount: 45000, currency: 'COP', category: 'Servicios', date: '2030-01-01', kind: 'expense' as const }],
    reminders: [{ id: 'reminder-1', title: 'Pagar agua', date: '2030-01-15', time: '09:00', notes: '' }],
  }],
};

describe('Vault backup safety', () => {
  it('calculates totals in cents without mixing currencies or losing income direction', () => {
    expect(calculateFinancialTotals([
      { description: 'A', amount: 0.1, currency: 'USD', category: 'Otros', date: null, kind: 'expense' },
      { description: 'B', amount: 0.2, currency: 'USD', category: 'Otros', date: null, kind: 'expense' },
      { description: 'Pago', amount: 100, currency: 'USD', category: 'Otros', date: null, kind: 'income' },
      { description: 'Agua', amount: 45000, currency: 'COP', category: 'Servicios', date: null, kind: 'expense' },
    ])).toEqual([
      { currency: 'COP', income: 0, expense: 45000, balance: -45000 },
      { currency: 'USD', income: 100, expense: 0.3, balance: 99.7 },
    ]);
  });
  it('round trips clear JSON without including an account identifier', async () => {
    const text = await encodeVaultBackup(backup);
    expect(await decodeVaultBackup(text)).toEqual(backup);
    expect(text).not.toContain('ownerUid');
  });
  it('encrypts private content, authenticates edits and rejects a wrong password', async () => {
    const encrypted = await encodeVaultBackup(backup, 'una contraseña segura');
    expect(encrypted).not.toContain('Factura privada');
    expect(await decodeVaultBackup(encrypted, 'una contraseña segura')).toEqual(backup);
    await expect(decodeVaultBackup(encrypted, 'otra contraseña')).rejects.toThrow();
    const tampered = JSON.parse(encrypted) as { ciphertext: string };
    tampered.ciphertext = `${tampered.ciphertext[0] === 'A' ? 'B' : 'A'}${tampered.ciphertext.slice(1)}`;
    await expect(decodeVaultBackup(JSON.stringify(tampered), 'una contraseña segura')).rejects.toThrow();
  });
  it('rejects unsafe image sources, impossible dates, duplicate IDs and unbounded encrypted work factors', async () => {
    expect(vaultChatRequestSchema.safeParse({ messages: [{ role: 'user', content: 'Mira', attachments: [{ dataUrl: 'https://tracker.example/factura.webp', name: 'x' }] }] }).success).toBe(false);
    expect(vaultBackupSchema.safeParse({ ...backup, threads: [{ ...backup.threads[0], reminders: [{ ...backup.threads[0].reminders[0], date: '2030-02-30' }] }] }).success).toBe(false);
    expect(vaultBackupSchema.safeParse({ ...backup, threads: [backup.threads[0], backup.threads[0]] }).success).toBe(false);
    const encrypted = JSON.parse(await encodeVaultBackup(backup, 'una contraseña segura')) as Record<string, unknown>;
    encrypted.iterations = 999999999;
    await expect(decodeVaultBackup(JSON.stringify(encrypted), 'una contraseña segura')).rejects.toThrow();
  });
});

describe('Vault IndexedDB persistence', () => {
  it('isolates accounts, survives reopening, and deletes only the selected account', async () => {
    const first = new VaultDatabase('superadmin-a');
    const other = new VaultDatabase('superadmin-b');
    await first.clear(); await other.clear();
    await first.saveThread(backup.threads[0]);
    expect(await other.listThreads()).toEqual([]);
    first.close();
    const reopened = new VaultDatabase('superadmin-a');
    expect((await reopened.listThreads())[0].messages[0].content).toBe('Factura privada');
    await other.saveThread({ ...backup.threads[0], title: 'Otra cuenta' });
    await reopened.clear();
    expect(await reopened.listThreads()).toEqual([]);
    expect((await other.listThreads())[0].title).toBe('Otra cuenta');
    reopened.close(); other.close();
  });
  it('imports by adding remapped threads without overwriting existing data', async () => {
    const db = new VaultDatabase('superadmin-import');
    await db.clear();
    await db.saveThread(backup.threads[0]);
    await db.importBackup(backup);
    const threads = await db.listThreads();
    expect(threads).toHaveLength(2);
    expect(new Set(threads.map(thread => thread.id)).size).toBe(2);
    expect(threads.flatMap(thread => thread.entries)).toHaveLength(2);
    const before = await db.listThreads();
    await expect(db.importBackup({ ...backup, threads: [{ ...backup.threads[0], title: '' }] })).rejects.toThrow();
    expect(await db.listThreads()).toEqual(before);
    await db.clear(); db.close();
  });
  it('rejects a thread that cannot be saved again after importing', async () => {
    const db = new VaultDatabase('superadmin-large');
    await db.saveThread(backup.threads[0]);
    const large = { ...backup.threads[0], messages: Array.from({ length: 350 }, (_, index) => ({ ...backup.threads[0].messages[0], id: `message-${index}`, content: 'x'.repeat(32000) })) };
    await expect(db.importBackup({ ...backup, threads: [large] })).rejects.toThrow(/10 MB/);
    expect((await db.listThreads()).map(thread => thread.id)).toEqual(['thread-1']);
    await expect(db.saveThread(large)).rejects.toThrow(/10 MB/);
    await db.clear(); db.close();
  });
  it('rolls back the entire import if an IndexedDB write fails mid-transaction', async () => {
    const db = new VaultDatabase('superadmin-atomic');
    await db.saveThread(backup.threads[0]);
    const original = await db.listThreads();
    const random = vi.spyOn(crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000000');
    try {
      await expect(db.importBackup({ ...backup, threads: [backup.threads[0], { ...backup.threads[0], id: 'second-thread' }] })).rejects.toThrow();
    } finally { random.mockRestore(); }
    expect(await db.listThreads()).toEqual(original);
    await db.clear(); db.close();
  });
  it('keeps a full vault exportable when an import exceeds the conversation limit', async () => {
    const db = new VaultDatabase('superadmin-limit');
    await db.importBackup({ ...backup, threads: Array.from({ length: 200 }, (_, index) => ({ ...backup.threads[0], id: `thread-${index}` })) });
    await expect(db.importBackup(backup)).rejects.toThrow(/200/);
    expect((await db.exportBackup()).threads).toHaveLength(200);
    await db.clear(); db.close();
  });
  it('preserves existing data on capacity errors, permits updates and recovers space after deletion', async () => {
    const db = new VaultDatabase('superadmin-replace');
    await db.saveThread(backup.threads[0]);
    await db.importBackup({ ...backup, threads: Array.from({ length: 199 }, (_, index) => ({ ...backup.threads[0], id: `additional-${index}` })) });
    await expect(db.saveThread({ ...backup.threads[0], id: 'overflow-thread' })).rejects.toThrow(/200/);
    expect((await db.listThreads()).find(thread => thread.id === 'thread-1')?.messages[0].content).toBe('Factura privada');
    await db.saveThread({ ...backup.threads[0], title: 'Título actualizado' });
    expect((await db.listThreads()).find(thread => thread.id === 'thread-1')?.title).toBe('Título actualizado');
    await db.deleteThread('thread-1');
    await db.saveThread({ ...backup.threads[0], id: 'new-thread' });
    expect((await db.listThreads()).length).toBe(200);
    await db.clear(); db.close();
  });
  it('keeps the user message and rolls back assistant records when saving fails, allowing a safe retry', async () => {
    const db = new VaultDatabase('superadmin-save-failure');
    const before = backup.threads[0];
    await db.saveThread(before);
    const after = { ...before, messages: [...before.messages, { id: 'assistant-reply', role: 'assistant' as const, content: 'Análisis', createdAt: 2000, attachments: [] }], entries: [...before.entries, { ...before.entries[0], id: 'another-entry' }] };
    const originalPut = IDBObjectStore.prototype.put;
    const failure = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      // A real asynchronous IndexedDB request error after the thread write was queued.
      if (this.name === 'metadata') return this.add(value, key);
      return originalPut.call(this, value, key);
    });
    try { await expect(db.saveThread(after)).rejects.toThrow(); }
    finally { failure.mockRestore(); }
    expect(await db.listThreads()).toEqual([before]);
    await db.saveThread(after);
    const retried = (await db.listThreads())[0];
    expect(retried.messages.filter(message => message.role === 'assistant')).toHaveLength(1);
    expect(retried.entries).toHaveLength(2);
    await db.clear(); db.close();
  });
  it('rejects an oversized combined import without changing the existing vault', async () => {
    const db = new VaultDatabase('superadmin-total');
    await db.saveThread(backup.threads[0]);
    const large = { ...backup.threads[0], messages: Array.from({ length: 300 }, (_, index) => ({ ...backup.threads[0].messages[0], id: `message-${index}`, content: 'x'.repeat(32000) })) };
    await expect(db.importBackup({ ...backup, threads: Array.from({ length: 6 }, (_, index) => ({ ...large, id: `large-${index}` })) })).rejects.toThrow(/50 MB/);
    expect((await db.listThreads()).map(thread => thread.id)).toEqual(['thread-1']);
    await db.clear(); db.close();
  });
  it('recovers a blocked upgrade after another tab closes without leaving an open handle', async () => {
    const owner = `superadmin-blocked-${crypto.randomUUID()}`;
    const name = `sarin-vault-v1:${encodeURIComponent(owner)}`;
    const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('threads', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = new VaultDatabase(owner);
    await expect(db.listThreads()).rejects.toThrow(/pestañas/);
    blocker.close();
    expect(await db.listThreads()).toEqual([]);
    await db.saveThread(backup.threads[0]);
    expect((await db.listThreads())[0].title).toBe('Servicios');
    db.close();
    const next = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 3);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('A zombie handle prevented the upgrade'));
    });
    next.close();
  });
});
