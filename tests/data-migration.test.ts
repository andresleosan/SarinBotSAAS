import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import {
  buildImportSql, buildReversePlan, canonicalJson, captureFirestoreSnapshot, collectFirestoreDocuments, decodeFirestoreValue,
  prepareMigration, privateDirectory, restoreFirestoreWrites, sha256, verifyImportedRows, verifyMigration,
  readPreparedBundle, resolveBackupDirectory, writePreparedBundle, writeSourceBackup,
} from '../scripts/lib/data-migration.mjs';
import { firestoreRequester, googleCloudSdkCommand, parseArguments, queryD1 } from '../scripts/cloudflare-data-migration.mjs';
import { createDataTestRuntime } from '../cloudflare/tests/data-runtime.mjs';

const prefix = 'projects/sarinbotsaas/databases/(default)/documents/';
const stamp = '2026-10-16T12:00:00.123456Z';
const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const dataUrl = `data:image/png;base64,${image.toString('base64')}`;
const rawDocument = (path: string, fields: Record<string, unknown>) => ({ name: `${prefix}${path}`, fields, createTime: stamp, updateTime: stamp });
function snapshot() {
  return { version: 1, projectId: 'sarinbotsaas', databaseId: '(default)', readTime: stamp,
    collections: ['businesses', 'businesses/missing/appointments', 'paymentImages'], missingAncestors: ['businesses/missing'],
    documents: [
      rawDocument('businesses/owner_quoted', { ownerUid: { stringValue: "uid'private" }, appointments: { integerValue: '10' }, amount: { doubleValue: 1.25 }, exactDouble: { doubleValue: 1 }, active: { booleanValue: true }, empty: { nullValue: null }, nested: { mapValue: { fields: { names: { arrayValue: { values: [{ stringValue: 'Sarin' }, { booleanValue: false }] } } } } } }),
      rawDocument('businesses/missing/appointments/a', { startAt: { integerValue: '1792147200000' } }),
      rawDocument('paymentImages/receipt', { ownerUid: { stringValue: 'owner' }, receiptDataUrl: { stringValue: dataUrl } }),
    ],
  };
}

describe('Firestore migration artifacts', () => {
  it('decodes only exactly representable JSON types and rejects unsupported values without printing contents', () => {
    expect(decodeFirestoreValue({ integerValue: '9007199254740991' })).toBe(Number.MAX_SAFE_INTEGER);
    expect(decodeFirestoreValue({ mapValue: {} })).toEqual({});
    expect(decodeFirestoreValue({ arrayValue: {} })).toEqual([]);
    for (const value of [{ integerValue: '9007199254740992' }, { doubleValue: 'NaN' }, { doubleValue: Infinity }, { doubleValue: -0 }, { timestampValue: stamp }, { bytesValue: 'cHJpdmF0ZQ==' }, { referenceValue: 'private/reference' }, { geoPointValue: { latitude: 1, longitude: 2 } }, { stringValue: 'private', booleanValue: true }]) {
      expect(() => decodeFirestoreValue(value)).toThrow(/MIGRATION_/);
      try { decodeFirestoreValue(value); } catch (error) { expect(String(error)).not.toContain('private'); }
    }
  });

  it('exports collection and document pagination recursively through missing ancestors at one read time', async () => {
    const calls: { url: URL; body: Record<string, unknown> }[] = [];
    const request = async (url: string, options: { body?: Record<string, unknown> }) => {
      const parsed = new URL(url), body = options.body ?? {};
      calls.push({ url: parsed, body });
      const pathname = decodeURIComponent(parsed.pathname);
      if (pathname.endsWith('/documents:listCollectionIds')) return body.pageToken ? { collectionIds: ['empty'] } : { collectionIds: ['businesses'], nextPageToken: 'root+next' };
      if (pathname.endsWith('/documents/businesses')) return parsed.searchParams.get('pageToken') ? { documents: [rawDocument('businesses/real', { name: { stringValue: 'business' } })] } : { documents: [{ name: `${prefix}businesses/missing` }], nextPageToken: 'docs/next' };
      if (pathname.endsWith('/documents/businesses/missing:listCollectionIds')) return { collectionIds: ['appointments'] };
      if (pathname.endsWith('/documents/businesses/missing/appointments')) return { documents: [rawDocument('businesses/missing/appointments/a', {})] };
      return pathname.endsWith(':listCollectionIds') ? {} : { documents: [] };
    };
    const exported = await collectFirestoreDocuments({ request, readTime: stamp });
    expect(exported.documents.map((document: { name: string }) => document.name)).toEqual([`${prefix}businesses/missing/appointments/a`, `${prefix}businesses/real`]);
    expect(exported.missingAncestors).toEqual(['businesses/missing']);
    for (const call of calls) {
      if (call.url.pathname.endsWith(':listCollectionIds')) expect(call.body.readTime).toBe(stamp);
      else { expect(call.url.searchParams.get('showMissing')).toBe('true'); expect(call.url.searchParams.get('readTime')).toBe(stamp); }
    }
  });

  it('fails on repeated pagination tokens, cross-project names and duplicate conflicting documents', async () => {
    await expect(collectFirestoreDocuments({ readTime: stamp, request: async () => ({ collectionIds: ['businesses'], nextPageToken: 'repeat' }) })).rejects.toThrow(/PAGINATION/);
    await expect(collectFirestoreDocuments({ readTime: stamp, request: async (url: string) => url.endsWith(':listCollectionIds') ? { collectionIds: ['businesses'] } : { documents: [{ ...rawDocument('businesses/a', {}), name: 'projects/other/databases/(default)/documents/businesses/a' }] } })).rejects.toThrow(/DOCUMENT_NAME/);
  });

  it('uses the server snapshot after the last drained write, including a write within the previous second', async () => {
    const serverTime = '2026-10-16T12:00:01.500000Z';
    const lastWrite = '2026-10-16T12:00:01.250000Z';
    const request = async (url: string, options: { body?: Record<string, unknown> }) => {
      if (url.endsWith(':runQuery')) {
        expect(options.body).toEqual({ structuredQuery: { select: { fields: [{ fieldPath: '__name__' }] }, from: [{ collectionId: 'users' }], limit: 1 } });
        return [{ readTime: serverTime }]; // An empty users query still supplies a server readTime.
      }
      const parsed = new URL(url), pathname = decodeURIComponent(parsed.pathname);
      if (pathname.endsWith('/documents:listCollectionIds')) { expect(options.body?.readTime).toBe(serverTime); return { collectionIds: ['users'] }; }
      if (pathname.endsWith('/documents/users')) return { documents: Date.parse(parsed.searchParams.get('readTime')!) >= Date.parse(lastWrite) ? [{ ...rawDocument('users/last', {}), updateTime: lastWrite }] : [] };
      return {};
    };
    const exported = await captureFirestoreSnapshot({ request });
    expect(exported.documents).toHaveLength(1);
    expect(exported.readTime).toBe(serverTime);
    expect(exported.snapshotBoundary).toBe('firestore-server-read-time');
    await expect(captureFirestoreSnapshot({ request: async () => [] })).rejects.toThrow('MIGRATION_SERVER_READ_TIME');
  });

  it('extracts canonical proof bytes with a hash reference and verifies every artifact', () => {
    const bundle = prepareMigration(snapshot(), { updatedAt: 1000 });
    expect(bundle.rows).toHaveLength(3);
    const receipt = bundle.rows.find((row: { path: string }) => row.path === 'paymentImages/receipt');
    expect(receipt?.data).toEqual({ ownerUid: 'owner' });
    expect(receipt?.blob).toEqual({ key: `payment-images/${sha256(image)}`, contentType: 'image/png', byteLength: 12, sha256: sha256(image) });
    expect(bundle.blobs[0].bytes.equals(image)).toBe(true);
    expect(verifyMigration(bundle)).toEqual({ documents: 3, blobs: 1, bytes: 12, sha256: bundle.manifest.sha256 });
    const tampered = { ...bundle, blobs: [{ ...bundle.blobs[0], bytes: Buffer.from('tampered') }] };
    expect(() => verifyMigration(tampered)).toThrow(/HASH|BLOB/);
  });

  it('extracts legacy inline receipt images without duplicating identical R2 bytes', () => {
    const source = snapshot();
    source.documents.push(rawDocument('paymentReceipts/legacy', { ownerUid: { stringValue: 'owner' }, receiptDataUrl: { stringValue: dataUrl } }));
    const bundle = prepareMigration(source, { updatedAt: 1000 });
    expect(bundle.blobs).toHaveLength(1);
    expect(bundle.rows.find((row: { path: string }) => row.path === 'paymentReceipts/legacy')?.blob?.sha256).toBe(sha256(image));
  });

  it('rejects every path or JSON shape unavailable through the shared runtime protocol before import', () => {
    for (const path of ['businesses/a/appointments/b/more/c', `users/${'a'.repeat(129)}`, 'unrecognized/a']) {
      const source = snapshot();
      source.documents.push(rawDocument(path, {}));
      expect(() => prepareMigration(source)).toThrow('MIGRATION_RUNTIME_COMPATIBILITY');
    }
    const source = snapshot();
    source.documents.push(rawDocument('users/unsafe', { constructor: { stringValue: 'private' } }));
    expect(() => prepareMigration(source)).toThrow('MIGRATION_RUNTIME_COMPATIBILITY');
    source.documents = [rawDocument('users/large', { body: { stringValue: 'x'.repeat(1024 * 1024) } })];
    expect(() => prepareMigration(source)).toThrow('MIGRATION_RUNTIME_COMPATIBILITY');
    const bundle = prepareMigration(snapshot());
    expect(bundle.manifest.runtimeCompatibility).toEqual({ documents: 3, allCompatible: true });
  });

  it('reports unresolved reservation counts without identities or content', () => {
    const source = snapshot();
    source.documents.push(rawDocument('responseQuotaTurns/private_reservation', { status: { stringValue: 'reserved' } }));
    source.documents.push(rawDocument('responseQuotaScopes/private_scope/periods/one', { reservedResponses: { integerValue: '2' } }));
    const bundle = prepareMigration(source);
    expect(bundle.manifest.counts).toMatchObject({ statusReserved: 1, reservedResponses: 2, reservedResponseDocuments: 1 });
    expect(canonicalJson(bundle.manifest.counts)).not.toContain('private');
  });

  it('writes immutable private artifacts outside the workspace and detects altered SQL or restore files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sarin-migration-fixture-'));
    try {
      await expect(resolveBackupDirectory(join(process.cwd(), 'work', 'forbidden'))).rejects.toThrow(/INSIDE_WORKSPACE/);
      const source = snapshot(), bundle = prepareMigration(source, { updatedAt: 1000 });
      await writeSourceBackup(directory, source);
      await writePreparedBundle(directory, bundle);
      expect(verifyMigration(await readPreparedBundle(directory)).documents).toBe(3);
      await expect(writePreparedBundle(directory, bundle)).rejects.toThrow();
      const sql = await readFile(join(directory, 'import.sql'));
      await writeFile(join(directory, 'import.sql'), 'SELECT 1;');
      await expect(readPreparedBundle(directory)).rejects.toThrow(/SQL_HASH/);
      await writeFile(join(directory, 'import.sql'), sql);
      await writeFile(join(directory, 'baseline-restore.json'), '{}');
      await expect(readPreparedBundle(directory)).rejects.toThrow(/RESTORE_HASH/);
    } finally {
      expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
      expect(basename(directory).startsWith('sarin-migration-fixture-')).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('creates and reopens a private backup directory using only the current operator permissions', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'sarin-migration-fixture-'));
    const directory = join(temporary, 'private');
    try {
      await privateDirectory(directory, { create: true });
      await writeFile(join(directory, 'synthetic.txt'), 'synthetic', { mode: 0o600 });
      await privateDirectory(directory);
      expect(await readFile(join(directory, 'synthetic.txt'), 'utf8')).toBe('synthetic');
      await privateDirectory(directory);
      if (process.platform === 'win32') {
        const { execFileSync } = await import('node:child_process');
        const code = "$backupAcl=Get-Acl -LiteralPath ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + Buffer.from(directory).toString('base64') + "'))); $backupSid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $backupRules=@($backupAcl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])); if(-not $backupAcl.AreAccessRulesProtected -or $backupRules.Count -ne 2 -or @($backupRules | Where-Object {$_.IdentityReference.Value -notin @($backupSid,'S-1-5-18') -or $_.IsInherited -or $_.AccessControlType -ne 'Allow'}).Count -gt 0){exit 1}; 'private'";
        expect(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()).toBe('private');
      }
    } finally {
      expect(dirname(resolve(temporary))).toBe(resolve(tmpdir()));
      expect(basename(temporary).startsWith('sarin-migration-fixture-')).toBe(true);
      await rm(temporary, { recursive: true, force: true });
    }
  });

  it('generates executable SQL with literal quoting and rejects a nonempty import target', () => {
    const bundle = prepareMigration(snapshot(), { updatedAt: 1000 });
    const sql = buildImportSql(bundle);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE app_documents(path TEXT PRIMARY KEY,parent TEXT,document_id TEXT,data TEXT,updated_at INTEGER,blob TEXT); CREATE TABLE app_revision(id INTEGER PRIMARY KEY,revision INTEGER); INSERT INTO app_revision VALUES(1,0); CREATE TABLE app_commits(request_id TEXT PRIMARY KEY,fingerprint TEXT,revision INTEGER);');
      db.exec(sql);
      const rows = db.prepare('SELECT * FROM app_documents ORDER BY path').all();
      expect(verifyImportedRows(bundle, rows)).toEqual({ documents: 3, sha256: bundle.manifest.sha256 });
      expect(() => db.exec(sql)).toThrow();
      expect(db.prepare('SELECT COUNT(*) AS count FROM app_documents').get()?.count).toBe(3);
      expect(db.prepare('SELECT revision FROM app_revision WHERE id=1').get()?.revision).toBe(0);
    } finally { db.close(); }
  });

  it('imports the generated SQL and image bytes into real local D1/R2 and reads them through the Worker bridge', async () => {
    const runtime = await createDataTestRuntime();
    try {
      const source = snapshot();
      source.documents.push(rawDocument('paymentReceipts/legacy', { ownerUid: { stringValue: 'owner' }, receiptDataUrl: { stringValue: dataUrl } }));
      const bundle = prepareMigration(source, { updatedAt: 1000 });
      for (const blob of bundle.blobs) await runtime.bucket.put(blob.key, blob.bytes, { httpMetadata: { contentType: blob.contentType } });
      await runtime.db.exec(buildImportSql(bundle));
      const imported = await runtime.db.prepare('SELECT * FROM app_documents ORDER BY path').all();
      expect(verifyImportedRows(bundle, imported.results).documents).toBe(4);
      expect((await runtime.db.prepare('SELECT revision FROM app_revision WHERE id=1').first()).revision).toBe(0);
      expect((await runtime.db.prepare('SELECT count(*) AS count FROM app_commits').first()).count).toBe(0);
      for (const path of ['paymentImages/receipt', 'paymentReceipts/legacy']) {
        const response = await runtime.fetch({ action: 'read', read: { kind: 'document', path } });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ revision: 0, documents: [{ path, data: { ownerUid: 'owner', receiptDataUrl: dataUrl } }] });
      }
      const bytes = await (await runtime.bucket.get(bundle.blobs[0].key)).arrayBuffer();
      expect(sha256(Buffer.from(bytes))).toBe(bundle.blobs[0].sha256);
      const absent = await runtime.fetch({ action: 'read', read: { kind: 'document', path: 'businesses/missing' } });
      expect(await absent.json()).toEqual({ revision: 0, documents: [] });
      await expect(runtime.db.exec(buildImportSql(bundle))).rejects.toThrow();
    } finally { await runtime.dispose(); }
  }, 20_000);

  it('requires dedicated resources and explicit final maintenance, and renews operator tokens only in memory', async () => {
    expect(() => parseArguments(['--import', '--directory', 'C:/private', '--database', 'sarin-bot-data', '--bucket', 'sarin-bot-files', '--remote'])).toThrow('MIGRATION_MAINTENANCE_REQUIRED');
    expect(() => parseArguments(['--import', '--directory', 'C:/private', '--database', 'other', '--bucket', 'sarin-bot-files'])).toThrow('MIGRATION_DEDICATED_RESOURCES');
    const tokens = ['synthetic-operator-token-one', 'synthetic-operator-token-two'];
    let supplied = 0, calls = 0;
    const request = firestoreRequester({ tokenSupplier: () => tokens[supplied++], fetchImpl: async (...args: Parameters<typeof fetch>) => {
      const options = args[1];
      expect(options?.redirect).toBe('error');
      expect(options?.headers).toMatchObject({ Authorization: `Bearer ${tokens[calls]}` });
      calls += 1;
      return calls === 1 ? new Response('{}', { status: 401 }) : Response.json({ collectionIds: [] });
    } });
    expect(await request(`https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}:listCollectionIds`, { method: 'POST', body: {} })).toEqual({ collectionIds: [] });
    expect(supplied).toBe(2);
    await expect(request('https://example.invalid/private', { method: 'GET' })).rejects.toThrow('MIGRATION_FIRESTORE_DESTINATION');
    await expect(request(`https://firestore.googleapis.com/v1/${prefix}users/private`, { method: 'DELETE' })).rejects.toThrow('MIGRATION_FIRESTORE_DESTINATION');
  });

  it('locates the Windows Google SDK Python entrypoint under lib rather than bin', () => {
    const sdk = resolve(tmpdir(), 'synthetic-google-cloud-sdk');
    const available = new Set([join(sdk, 'platform', 'bundledpython', 'python.exe'), join(sdk, 'lib', 'gcloud.py')]);
    expect(googleCloudSdkCommand(sdk, (file) => available.has(String(file)))).toEqual({ file: join(sdk, 'platform', 'bundledpython', 'python.exe'), arguments: [join(sdk, 'lib', 'gcloud.py')] });
    expect(() => googleCloudSdkCommand(sdk, () => false)).toThrow('MIGRATION_GCLOUD_SDK_MISSING');
  });

  it('reads machine JSON from the installed Wrangler CLI without suppressing stdout', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sarin-migration-fixture-'));
    try {
      await privateDirectory(directory);
      expect(queryD1(directory, { '--database': 'sarin-bot-data' }, 'SELECT 1 AS synthetic;')).toEqual([{ synthetic: 1 }]);
    } finally {
      expect(dirname(resolve(directory))).toBe(resolve(tmpdir()));
      expect(basename(directory).startsWith('sarin-migration-fixture-')).toBe(true);
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it('preserves original Firestore field types and image bytes when creating a baseline restore', () => {
    const original = snapshot();
    const writes = restoreFirestoreWrites(original);
    expect(writes.map((write: { update: { name: string; fields: unknown } }) => write.update.fields)).toEqual(original.documents.map(document => document.fields));
    expect(writes[0].currentDocument).toEqual({ updateTime: stamp });
  });

  it('reconciles D1 updates, new documents, deleted paths and R2 images for a guarded rollback plan', () => {
    const baseline = snapshot();
    const bundle = prepareMigration(baseline, { updatedAt: 1000 });
    const rows = bundle.rows.filter((row: { path: string }) => row.path !== 'businesses/missing/appointments/a').map((row: { path: string; data: Record<string, unknown> }) => row.path.startsWith('businesses/') ? { ...row, data: { ...row.data, appointments: 11 } } : row);
    rows.push({ path: 'users/new', parent: 'users', document_id: 'new', data: { uid: 'new', createdAt: 123 }, updated_at: 1001, blob: null });
    const plan = buildReversePlan({ baseline, rows, blobs: bundle.blobs, revision: 7 });
    expect(plan.requiresMaintenance).toBe(true);
    expect(plan.revision).toBe(7);
    expect(plan.upserts).toHaveLength(3);
    const updated = plan.upserts.find((write: { update: { name: string } }) => write.update.name.endsWith('businesses/owner_quoted'));
    expect(updated?.update.fields.appointments).toEqual({ integerValue: '11' });
    expect(updated?.update.fields.exactDouble).toEqual({ doubleValue: 1 });
    const restoredImage = plan.upserts.find((write: { update: { name: string } }) => write.update.name.endsWith('paymentImages/receipt'));
    expect(restoredImage?.update.fields.receiptDataUrl).toEqual({ stringValue: dataUrl });
    expect(plan.deletionCandidates).toEqual([{ delete: `${prefix}businesses/missing/appointments/a`, currentDocument: { updateTime: stamp } }]);
    expect(plan.upserts.find((write: { update: { name: string } }) => write.update.name.endsWith('users/new'))?.currentDocument).toEqual({ exists: false });
  });

  it('hashes canonical maps independently of insertion order and rejects silent JSON coercion', () => {
    expect(canonicalJson({ b: 2, a: { z: 1, c: true } })).toBe('{"a":{"c":true,"z":1},"b":2}');
    for (const value of [{ a: undefined }, { a: NaN }, { a: BigInt(1) }, { a: new Date() }]) expect(() => canonicalJson(value)).toThrow(/MIGRATION_/);
  });
});
