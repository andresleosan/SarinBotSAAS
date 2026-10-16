import { createHash } from 'node:crypto';
import { mkdir, realpath, lstat, chmod, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { isDataJson, isDataPath } from '../../shared/data-protocol.ts';

export const PROJECT_ID = 'sarinbotsaas';
export const DOCUMENT_PREFIX = `projects/${PROJECT_ID}/databases/(default)/documents/`;
const ROOT = DOCUMENT_PREFIX.slice(0, -1);
const fail = (code) => { throw new Error(`MIGRATION_${code}`); };
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

export function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

export function canonicalJson(value) {
  const normalize = (item, depth = 0) => {
    if (depth > 40) fail('JSON_DEPTH');
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'string') { if (!item.isWellFormed()) fail('STRING_ENCODING'); return item; }
    if (typeof item === 'number') { if (!Number.isFinite(item) || Object.is(item, -0)) fail('NUMBER'); return item; }
    if (Array.isArray(item)) {
      if (Object.keys(item).length !== item.length) fail('JSON_ARRAY');
      return item.map((child) => normalize(child, depth + 1));
    }
    if (!record(item)) fail('JSON_TYPE');
    return Object.fromEntries(Object.keys(item).sort().map((key) => {
      if (!key.isWellFormed()) fail('STRING_ENCODING');
      return [key, normalize(item[key], depth + 1)];
    }));
  };
  return JSON.stringify(normalize(value));
}

export function documentPath(name) {
  if (typeof name !== 'string' || !name.startsWith(DOCUMENT_PREFIX)) fail('DOCUMENT_NAME');
  const path = name.slice(DOCUMENT_PREFIX.length);
  validatePath(path, true);
  return path;
}

function validatePath(path, document) {
  if (typeof path !== 'string' || !path || !path.isWellFormed() || /[\u0000-\u001f\u007f]/.test(path) || Buffer.byteLength(path) > 6144) fail('PATH');
  const parts = path.split('/');
  if (parts.length > 200 || parts.some((part) => !part || part === '.' || part === '..' || Buffer.byteLength(part) > 1500) || (parts.length % 2 === 0) !== document) fail('PATH');
  return parts;
}

export function decodeFirestoreValue(value, depth = 0) {
  if (!record(value) || Object.keys(value).length !== 1 || depth > 30) fail('VALUE_SHAPE');
  if (own(value, 'nullValue') && value.nullValue === null) return null;
  if (own(value, 'booleanValue') && typeof value.booleanValue === 'boolean') return value.booleanValue;
  if (own(value, 'stringValue') && typeof value.stringValue === 'string') { canonicalJson(value.stringValue); return value.stringValue; }
  if (own(value, 'integerValue') && typeof value.integerValue === 'string' && /^-?(?:0|[1-9][0-9]*)$/.exec(value.integerValue)?.[0] === value.integerValue) {
    const number = Number(value.integerValue);
    if (!Number.isSafeInteger(number) || Object.is(number, -0)) fail('INTEGER_PRECISION');
    return number;
  }
  if (own(value, 'doubleValue') && typeof value.doubleValue === 'number') {
    if (!Number.isFinite(value.doubleValue) || Object.is(value.doubleValue, -0)) fail('DOUBLE_PRECISION');
    return value.doubleValue;
  }
  if (own(value, 'arrayValue') && record(value.arrayValue) && Object.keys(value.arrayValue).every((key) => key === 'values')) {
    const values = value.arrayValue.values ?? [];
    if (!Array.isArray(values) || values.some((child) => record(child) && own(child, 'arrayValue'))) fail('ARRAY_SHAPE');
    return values.map((child) => decodeFirestoreValue(child, depth + 1));
  }
  if (own(value, 'mapValue') && record(value.mapValue) && Object.keys(value.mapValue).every((key) => key === 'fields')) return decodeFields(value.mapValue.fields ?? {}, depth + 1);
  const unsupported = ['timestampValue', 'bytesValue', 'referenceValue', 'geoPointValue'].find((key) => own(value, key));
  fail(unsupported ? `UNSUPPORTED_${unsupported.replace('Value', '').toUpperCase()}` : 'VALUE_TYPE');
}

function decodeFields(fields, depth = 0) {
  if (!record(fields)) fail('FIELDS');
  const data = Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value, depth + 1)]));
  canonicalJson(data);
  return data;
}

export function encodeFirestoreValue(value, hint) {
  if (value === null) return { nullValue: null };
  if (typeof value === 'string') { canonicalJson(value); return { stringValue: value }; }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    canonicalJson(value);
    if (hint && own(hint, 'doubleValue')) return { doubleValue: value };
    return Number.isSafeInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) fail('NESTED_ARRAY');
    return { arrayValue: { values: value.map((item, index) => encodeFirestoreValue(item, hint?.arrayValue?.values?.[index])) } };
  }
  if (!record(value)) fail('JSON_TYPE');
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, encodeFirestoreValue(child, hint?.mapValue?.fields?.[key])])) } };
}

/** request returns parsed JSON; authentication and bounded retries belong to the CLI. */
export async function collectFirestoreDocuments({ request, readTime }) {
  if (typeof readTime !== 'string' || !Number.isFinite(Date.parse(readTime))) fail('READ_TIME');
  const documents = new Map(), missing = new Set(), collections = new Set();
  const encodeResource = (resource) => resource.split('/').map(encodeURIComponent).join('/');
  const endpoint = (resource) => `https://firestore.googleapis.com/v1/${encodeResource(resource)}`;
  async function pages(resource, kind) {
    const items = [], tokens = new Set();
    let pageToken;
    do {
      if (pageToken && tokens.has(pageToken)) fail('PAGINATION_CYCLE');
      if (pageToken) tokens.add(pageToken);
      let response;
      if (kind === 'collections') {
        response = await request(`${endpoint(resource)}:listCollectionIds`, { method: 'POST', body: { pageSize: 100, readTime, ...(pageToken ? { pageToken } : {}) } });
      } else {
        const url = new URL(endpoint(resource));
        url.searchParams.set('pageSize', '100'); url.searchParams.set('showMissing', 'true'); url.searchParams.set('readTime', readTime);
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        response = await request(url.href, { method: 'GET' });
      }
      if (!record(response)) fail('RESPONSE_SHAPE');
      const page = response[kind === 'collections' ? 'collectionIds' : 'documents'] ?? [];
      if (!Array.isArray(page)) fail('RESPONSE_SHAPE');
      items.push(...page);
      pageToken = response.nextPageToken;
      if (pageToken !== undefined && typeof pageToken !== 'string') fail('PAGINATION_TOKEN');
    } while (pageToken);
    return items;
  }
  async function visit(parent) {
    const ids = await pages(parent, 'collections');
    for (const id of ids) {
      if (typeof id !== 'string' || !id || id.includes('/')) fail('COLLECTION_ID');
      const resource = `${parent}/${id}`, relative = resource.slice(DOCUMENT_PREFIX.length);
      validatePath(relative, false);
      if (collections.has(relative)) fail('DUPLICATE_COLLECTION');
      collections.add(relative);
      for (const document of await pages(resource, 'documents')) {
        if (!record(document)) fail('DOCUMENT_SHAPE');
        const path = documentPath(document.name);
        if (path.slice(0, path.lastIndexOf('/')) !== relative) fail('DOCUMENT_PARENT');
        if (documents.has(path) || missing.has(path)) fail('DUPLICATE_DOCUMENT');
        if (!own(document, 'fields') && !document.createTime && !document.updateTime) missing.add(path);
        else {
          if (document.fields !== undefined && !record(document.fields)) fail('FIELDS');
          if (!document.updateTime || !Number.isFinite(Date.parse(document.updateTime))) fail('UPDATE_TIME');
          documents.set(path, document);
        }
        await visit(document.name);
      }
    }
  }
  await visit(ROOT);
  return { version: 1, projectId: PROJECT_ID, databaseId: '(default)', readTime,
    documents: [...documents.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, value]) => value),
    missingAncestors: [...missing].sort(), collections: [...collections].sort() };
}

/** Obtain a strong server snapshot only after the operator has drained/stopped every writer. */
export async function captureFirestoreSnapshot({ request }) {
  const response = await request(`https://firestore.googleapis.com/v1/${ROOT}:runQuery`, {
    method: 'POST', body: { structuredQuery: { select: { fields: [{ fieldPath: '__name__' }] }, from: [{ collectionId: 'users' }], limit: 1 } },
  });
  if (!Array.isArray(response) || !response.length || response.some((item) => !record(item))) fail('SERVER_READ_TIME');
  const readTime = response.at(-1).readTime;
  if (typeof readTime !== 'string' || !Number.isFinite(Date.parse(readTime))) fail('SERVER_READ_TIME');
  return { ...await collectFirestoreDocuments({ request, readTime }), snapshotBoundary: 'firestore-server-read-time' };
}

function validateSnapshot(snapshot) {
  if (!record(snapshot) || snapshot.version !== 1 || snapshot.projectId !== PROJECT_ID || snapshot.databaseId !== '(default)' || !Array.isArray(snapshot.documents) || !Array.isArray(snapshot.missingAncestors) || !Array.isArray(snapshot.collections)) fail('SNAPSHOT');
  const seen = new Set();
  for (const document of snapshot.documents) {
    const path = documentPath(document.name);
    if (seen.has(path) || !record(document.fields ?? {}) || typeof document.updateTime !== 'string' || !Number.isFinite(Date.parse(document.updateTime))) fail('SNAPSHOT_DOCUMENT');
    seen.add(path);
  }
  for (const path of snapshot.missingAncestors) { validatePath(path, true); if (seen.has(path)) fail('MISSING_ANCESTOR'); }
  for (const path of snapshot.collections) validatePath(path, false);
  canonicalJson(snapshot);
}

function parseImage(value) {
  if (typeof value !== 'string') fail('IMAGE_FORMAT');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[0] !== value) fail('IMAGE_FORMAT');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.length < 12 || bytes.length > 150 * 1024 || bytes.toString('base64') !== match[2]) fail('IMAGE_BYTES');
  const type = match[1];
  if ((type === 'image/png' && !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    || (type === 'image/jpeg' && !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255))
    || (type === 'image/webp' && !(bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'))) fail('IMAGE_SIGNATURE');
  const hash = sha256(bytes);
  return { key: `payment-images/${hash}`, contentType: type, byteLength: bytes.length, sha256: hash, bytes };
}

function imageReference(blob) { return { key: blob.key, contentType: blob.contentType, byteLength: blob.byteLength, sha256: blob.sha256 }; }

function validateRuntimeDocument(path, data) {
  if (!isDataPath(path, true) || !isDataJson(data) || Buffer.byteLength(JSON.stringify(data)) > 1024 * 1024) fail('RUNTIME_COMPATIBILITY');
}

export function prepareMigration(snapshot, { updatedAt = Date.now() } = {}) {
  validateSnapshot(snapshot);
  if (!Number.isSafeInteger(updatedAt) || updatedAt < 0) fail('UPDATED_AT');
  const unique = new Map();
  const rows = snapshot.documents.map((document) => {
    const path = documentPath(document.name), parts = validatePath(path, true), data = decodeFields(document.fields ?? {});
    validateRuntimeDocument(path, data);
    let blob = null;
    if (parts.length === 2 && ['paymentImages', 'paymentReceipts'].includes(parts[0]) && own(data, 'receiptDataUrl')) {
      const extracted = parseImage(data.receiptDataUrl);
      delete data.receiptDataUrl;
      unique.set(extracted.sha256, extracted);
      blob = imageReference(extracted);
    }
    return { path, parent: parts.slice(0, -1).join('/'), document_id: parts.at(-1), data, updated_at: updatedAt, blob };
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const blobs = [...unique.values()].sort((a, b) => a.key < b.key ? -1 : 1);
  let statusReserved = 0, reservedResponses = 0, reservedResponseDocuments = 0;
  for (const row of rows) {
    if (row.data.status === 'reserved') statusReserved += 1;
    if (own(row.data, 'reservedResponses')) {
      if (!Number.isSafeInteger(row.data.reservedResponses) || row.data.reservedResponses < 0 || !Number.isSafeInteger(reservedResponses + row.data.reservedResponses)) fail('RESERVATION_COUNT');
      reservedResponses += row.data.reservedResponses;
      reservedResponseDocuments += 1;
    }
  }
  const body = { version: 1, projectId: PROJECT_ID, sourceSha256: sha256(canonicalJson(snapshot)), updatedAt,
    runtimeCompatibility: { documents: rows.length, allCompatible: true },
    counts: { documents: rows.length, collections: snapshot.collections.length, missingAncestors: snapshot.missingAncestors.length, blobs: blobs.length, blobBytes: blobs.reduce((sum, blob) => sum + blob.byteLength, 0), statusReserved, reservedResponses, reservedResponseDocuments },
    documents: rows.map((row) => ({ path: row.path, sha256: sha256(canonicalJson(row)) })), blobs: blobs.map(imageReference) };
  return { source: snapshot, rows, blobs, manifest: { ...body, sha256: sha256(canonicalJson(body)) } };
}

export function verifyMigration(bundle) {
  const expected = prepareMigration(bundle.source, { updatedAt: bundle.manifest?.updatedAt });
  if (canonicalJson(expected.manifest) !== canonicalJson(bundle.manifest) || canonicalJson(expected.rows) !== canonicalJson(bundle.rows)) fail('MANIFEST_HASH');
  if (!Array.isArray(bundle.blobs) || bundle.blobs.length !== expected.blobs.length) fail('BLOB_COUNT');
  const byHash = new Map(bundle.blobs.map((blob) => [blob.sha256, blob]));
  if (byHash.size !== bundle.blobs.length) fail('BLOB_DUPLICATE');
  for (const blob of expected.blobs) {
    const actual = byHash.get(blob.sha256);
    if (!actual || !Buffer.isBuffer(actual.bytes) || sha256(actual.bytes) !== blob.sha256 || canonicalJson(imageReference(actual)) !== canonicalJson(imageReference(blob))) fail('BLOB_HASH');
  }
  return { documents: bundle.rows.length, blobs: bundle.blobs.length, bytes: bundle.manifest.counts.blobBytes, sha256: bundle.manifest.sha256 };
}

export function sqlQuote(value) {
  if (typeof value !== 'string' || value.includes('\0') || !value.isWellFormed()) fail('SQL_VALUE');
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildImportSql(bundle) {
  verifyMigration(bundle);
  const statements = ["SELECT json(CASE WHEN (SELECT count(*) FROM app_documents)=0 AND (SELECT revision FROM app_revision WHERE id=1)=0 AND (SELECT count(*) FROM app_commits)=0 THEN '{}' ELSE 'SARIN_IMPORT_TARGET_NOT_EMPTY' END);"];
  for (const row of bundle.rows) {
    const values = [row.path, row.parent, row.document_id, canonicalJson(row.data)].map(sqlQuote);
    values.push(String(row.updated_at), row.blob ? sqlQuote(canonicalJson(row.blob)) : 'NULL');
    const statement = `INSERT INTO app_documents(path,parent,document_id,data,updated_at,blob) VALUES(${values.join(',')});`;
    if (Buffer.byteLength(statement) > 90_000) fail('SQL_STATEMENT_SIZE');
    statements.push(statement);
  }
  return statements.join('\n') + '\n';
}

export function normalizeImportedRow(row) {
  if (!record(row)) fail('ROW');
  const parts = validatePath(row.path, true);
  let data, blob;
  try { data = typeof row.data === 'string' ? JSON.parse(row.data) : row.data; blob = typeof row.blob === 'string' ? JSON.parse(row.blob) : row.blob ?? null; } catch { fail('ROW_JSON'); }
  if (!record(data) || row.parent !== parts.slice(0, -1).join('/') || row.document_id !== parts.at(-1) || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) fail('ROW');
  validateRuntimeDocument(row.path, data);
  canonicalJson(data);
  if (blob && (!record(blob) || !/^[a-f0-9]{64}$/.test(blob.sha256) || blob.key !== `payment-images/${blob.sha256}` || !['image/png', 'image/jpeg', 'image/webp'].includes(blob.contentType) || !Number.isSafeInteger(blob.byteLength) || blob.byteLength < 12 || blob.byteLength > 150 * 1024)) fail('ROW_BLOB');
  return { path: row.path, parent: row.parent, document_id: row.document_id, data, updated_at: row.updated_at, blob };
}

export function verifyImportedRows(bundle, rows) {
  verifyMigration(bundle);
  const normalized = rows.map(normalizeImportedRow).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (canonicalJson(normalized) !== canonicalJson(bundle.rows)) fail('IMPORTED_DOCUMENT_HASH');
  return { documents: rows.length, sha256: bundle.manifest.sha256 };
}

export function restoreFirestoreWrites(snapshot) {
  validateSnapshot(snapshot);
  return snapshot.documents.map((document) => ({ update: { name: document.name, fields: structuredClone(document.fields ?? {}) }, currentDocument: { updateTime: document.updateTime } }));
}

export function buildReversePlan({ baseline, rows, blobs, revision }) {
  validateSnapshot(baseline);
  if (!Number.isSafeInteger(revision) || revision < 0) fail('REVISION');
  const originals = new Map(baseline.documents.map((document) => [documentPath(document.name), document]));
  const present = new Set(), byHash = new Map(blobs.map((blob) => [blob.sha256, blob]));
  const upserts = rows.map(normalizeImportedRow).map((row) => {
    if (present.has(row.path)) fail('DUPLICATE_DOCUMENT');
    present.add(row.path);
    const data = { ...row.data }, original = originals.get(row.path);
    if (row.blob) {
      const blob = byHash.get(row.blob.sha256);
      if (!blob || !Buffer.isBuffer(blob.bytes) || sha256(blob.bytes) !== row.blob.sha256 || blob.bytes.length !== row.blob.byteLength) fail('RESTORE_BLOB_HASH');
      const url = `data:${row.blob.contentType};base64,${blob.bytes.toString('base64')}`;
      if (canonicalJson(imageReference(parseImage(url))) !== canonicalJson(row.blob)) fail('RESTORE_BLOB_HASH');
      if (own(data, 'receiptDataUrl')) fail('RESTORE_BLOB_COLLISION');
      data.receiptDataUrl = url;
    }
    const fields = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, encodeFirestoreValue(value, original?.fields?.[key])]));
    return { update: { name: `${DOCUMENT_PREFIX}${row.path}`, fields }, currentDocument: original ? { updateTime: original.updateTime } : { exists: false } };
  });
  const deletionCandidates = [...originals].filter(([path]) => !present.has(path)).map(([, document]) => ({ delete: document.name, currentDocument: { updateTime: document.updateTime } }));
  const body = { version: 1, projectId: PROJECT_ID, requiresMaintenance: true, revision, baselineSha256: sha256(canonicalJson(baseline)), upserts, deletionCandidates };
  return { ...body, sha256: sha256(canonicalJson(body)) };
}

const workspace = fileURLToPath(new URL('../../', import.meta.url));
function within(parent, child) { const difference = relative(parent, child); return difference === '' || (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference)); }

/** Resolve existing ancestors before writes so a symlink cannot send a backup into Git. */
export async function resolveBackupDirectory(directory, { workspaceRoot = workspace } = {}) {
  if (typeof directory !== 'string' || !isAbsolute(directory)) fail('BACKUP_ABSOLUTE_PATH');
  const target = resolve(directory), root = await realpath(workspaceRoot);
  let ancestor = target;
  const suffix = [];
  while (true) {
    try { ancestor = await realpath(ancestor); break; }
    catch (error) {
      if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) fail('BACKUP_PATH');
      suffix.unshift(basename(ancestor)); ancestor = dirname(ancestor);
    }
  }
  const final = join(ancestor, ...suffix);
  if (within(root, final)) fail('BACKUP_INSIDE_WORKSPACE');
  return final;
}

export async function privateDirectory(directory, { create = false, workspaceRoot = workspace } = {}) {
  const target = await resolveBackupDirectory(directory, { workspaceRoot });
  if (create) {
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await mkdir(target, { mode: 0o700 }); // Never reuse a prior export directory silently.
  }
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('BACKUP_DIRECTORY');
  if (process.platform === 'win32') {
    const encodedPath = Buffer.from(target, 'utf8').toString('base64');
    const command = `$ErrorActionPreference='Stop'; $backupTarget=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}')); $backupDirectory=New-Object IO.DirectoryInfo($backupTarget); $backupAcl=$backupDirectory.GetAccessControl([Security.AccessControl.AccessControlSections]::Access); $backupAcl.SetAccessRuleProtection($true,$false); foreach($backupOldRule in @($backupAcl.GetAccessRules($true,$false,[Security.Principal.SecurityIdentifier]))){[void]$backupAcl.RemoveAccessRuleSpecific($backupOldRule)}; $backupUser=[Security.Principal.WindowsIdentity]::GetCurrent().User; $backupSystem=New-Object Security.Principal.SecurityIdentifier('S-1-5-18'); foreach($backupSid in @($backupUser,$backupSystem)){$backupRule=New-Object Security.AccessControl.FileSystemAccessRule($backupSid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'); [void]$backupAcl.AddAccessRule($backupRule)}; $backupDirectory.SetAccessControl($backupAcl)`;
    try {
      execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { fail('BACKUP_PERMISSIONS'); }
  } else await chmod(target, 0o700);
  return target;
}

export async function writePrivateFile(directory, name, content) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') fail('ARTIFACT_NAME');
  const file = join(directory, name);
  await writeFile(file, content, { mode: 0o600, flag: 'wx' });
  return file;
}

export async function readPrivateFile(directory, name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(name) || name === '.' || name === '..') fail('ARTIFACT_NAME');
  const file = join(directory, name), info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 512 * 1024 * 1024) fail('ARTIFACT_FILE');
  return readFile(file);
}

export async function writeSourceBackup(directory, source) {
  validateSnapshot(source);
  const bytes = Buffer.from(canonicalJson(source));
  await writePrivateFile(directory, 'firestore-export.json', bytes);
  const manifest = { version: 1, projectId: PROJECT_ID, sha256: sha256(bytes), counts: { documents: source.documents.length, collections: source.collections.length, missingAncestors: source.missingAncestors.length }, readTime: source.readTime };
  await writePrivateFile(directory, 'firestore-manifest.json', canonicalJson(manifest));
  return manifest;
}

export async function readSourceBackup(directory) {
  const bytes = await readPrivateFile(directory, 'firestore-export.json');
  const manifest = JSON.parse((await readPrivateFile(directory, 'firestore-manifest.json')).toString('utf8'));
  if (manifest.projectId !== PROJECT_ID || sha256(bytes) !== manifest.sha256) fail('SOURCE_HASH');
  const source = JSON.parse(bytes.toString('utf8'));
  validateSnapshot(source);
  if (source.documents.length !== manifest.counts?.documents || source.collections.length !== manifest.counts?.collections || source.missingAncestors.length !== manifest.counts?.missingAncestors) fail('SOURCE_COUNTS');
  return source;
}

export async function writePreparedBundle(directory, bundle) {
  verifyMigration(bundle);
  const sql = buildImportSql(bundle);
  const blobDirectory = join(directory, 'blobs');
  await mkdir(blobDirectory, { mode: 0o700 });
  for (const blob of bundle.blobs) await writePrivateFile(blobDirectory, blob.sha256, blob.bytes);
  await writePrivateFile(directory, 'documents.json', canonicalJson(bundle.rows));
  await writePrivateFile(directory, 'migration-manifest.json', canonicalJson(bundle.manifest));
  await writePrivateFile(directory, 'import.sql', sql);
  await writePrivateFile(directory, 'baseline-restore.json', canonicalJson({ version: 1, requiresMaintenance: true, sourceSha256: bundle.manifest.sourceSha256, writes: restoreFirestoreWrites(bundle.source) }));
}

export async function readPreparedBundle(directory) {
  const source = await readSourceBackup(directory);
  const manifest = JSON.parse((await readPrivateFile(directory, 'migration-manifest.json')).toString('utf8'));
  const rows = JSON.parse((await readPrivateFile(directory, 'documents.json')).toString('utf8'));
  if (!Array.isArray(manifest.blobs)) fail('BLOB_MANIFEST');
  const blobDirectory = join(directory, 'blobs'), info = await lstat(blobDirectory);
  if (!info.isDirectory() || info.isSymbolicLink()) fail('BLOB_DIRECTORY');
  const blobs = [];
  for (const blob of manifest.blobs) {
    if (!/^[a-f0-9]{64}$/.test(blob.sha256)) fail('BLOB_HASH');
    blobs.push({ ...blob, bytes: await readPrivateFile(blobDirectory, blob.sha256) });
  }
  const bundle = { source, manifest, rows, blobs };
  verifyMigration(bundle);
  if ((await readPrivateFile(directory, 'import.sql')).toString('utf8') !== buildImportSql(bundle)) fail('SQL_HASH');
  const restore = { version: 1, requiresMaintenance: true, sourceSha256: bundle.manifest.sourceSha256, writes: restoreFirestoreWrites(source) };
  if ((await readPrivateFile(directory, 'baseline-restore.json')).toString('utf8') !== canonicalJson(restore)) fail('RESTORE_HASH');
  return bundle;
}
