import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Hash Git blobs, never runtime configuration or untracked/private files.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = 'docs/qa/2026-10-18-whatsapp-adaptation-baseline.manifest.json';
const followupPaths = [
  'docs/qa/2026-10-18-whatsapp-adaptation-baseline.md',
  manifestPath,
  'scripts/verify-whatsapp-baseline.mjs',
];
const args = process.argv.slice(2);
const write = args.includes('--write');
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const existing = write ? null : JSON.parse(readFileSync(resolve(root, manifestPath), 'utf8'));
const sourceCommit = option('--source') ?? existing?.sourceCommit;
if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) throw new Error('Provide an exact --source commit SHA');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const git = (...argv) => {
  const result = spawnSync('git', argv, { cwd: root, maxBuffer: 128 * 1024 * 1024, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`Git ${argv[0]} failed (${result.status})`);
  return result.stdout;
};
const lf = (bytes) => {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    return text.includes('\0') ? null : Buffer.from(text.replace(/\r\n/g, '\n'));
  } catch { return null; }
};
const entries = git('ls-tree', '-rz', '--full-tree', sourceCommit).toString('utf8').split('\0').filter(Boolean).map((line) => {
  const [, mode, type, blob, path] = /^(\d+) (\w+) ([a-f0-9]+)\t([\s\S]+)$/.exec(line) ?? [];
  if (!path || type !== 'blob' || /(^|\/)(node_modules|\.next|\.superpowers)(\/|$)/.test(path)
    || /(^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.example')) throw new Error('Unexpected source input');
  if (followupPaths.includes(path)) throw new Error('Source commit already contains the baseline followup');
  return { mode, blob, path };
}).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
const batch = spawnSync('git', ['cat-file', '--batch'], {
  cwd: root, input: entries.map((entry) => entry.blob).join('\n') + '\n',
  maxBuffer: 128 * 1024 * 1024, windowsHide: true,
});
if (batch.error || batch.status !== 0) throw new Error(`Git blob extraction failed (${batch.status})`);
let offset = 0;
const blobs = new Map();
const files = entries.map(({ mode, blob, path }) => {
  const end = batch.stdout.indexOf(10, offset);
  const [actual, type, length] = batch.stdout.subarray(offset, end).toString('utf8').split(' ');
  if (actual !== blob || type !== 'blob' || !/^\d+$/.test(length)) throw new Error('Invalid Git blob response');
  const bytes = batch.stdout.subarray(end + 1, end + 1 + Number(length));
  offset = end + 2 + Number(length);
  const normalized = lf(bytes);
  const working = readFileSync(resolve(root, path));
  const workingLf = lf(working);
  if (!bytes.equals(working) && !(normalized && workingLf && normalized.equals(workingLf))) throw new Error(`Source mismatch: ${path}`);
  blobs.set(path, bytes);
  return { path, mode, gitBlob: blob, bytes: bytes.length, sha256: sha(bytes), ...(normalized ? { lfSha256: sha(normalized) } : {}) };
});
if (offset !== batch.stdout.length) throw new Error('Unexpected trailing Git blob output');
const referencePublic = option('--reference-public');
const publicAssets = files.filter((entry) => entry.path.startsWith('public/')).map((entry) => {
  const bytes = blobs.get(entry.path);
  const reference = referencePublic ? readFileSync(resolve(referencePublic, entry.path.slice(7))) : null;
  const normalized = lf(bytes);
  const referenceLf = reference && lf(reference);
  if (reference && !bytes.equals(reference) && !(normalized && referenceLf && normalized.equals(referenceLf))) throw new Error(`Public asset mismatch: ${entry.path}`);
  const old = existing?.publicAssets.find((asset) => asset.path === entry.path);
  if (!reference && !old) throw new Error('Writing requires --reference-public');
  const runtime = reference ? { bytes: reference.length, sha256: sha(reference), ...(referenceLf ? { lfSha256: sha(referenceLf) } : {}) } : old.runtime;
  const rawEqual = entry.sha256 === runtime.sha256;
  const lfEqual = normalized ? sha(normalized) === runtime.lfSha256 : null;
  if (!rawEqual && lfEqual !== true) throw new Error(`Recorded runtime asset mismatch: ${entry.path}`);
  return { path: entry.path, kind: normalized ? 'utf8-text' : 'binary', sourceSha256: entry.sha256, runtime, rawEqual, lfEqual };
});
const manifest = {
  schemaVersion: 1,
  sourceCommit,
  sourceTree: git('rev-parse', `${sourceCommit}^{tree}`).toString('utf8').trim(),
  algorithm: 'SHA-256 of every tracked Git blob at sourceCommit; UTF-8 text additionally hashes CRLF-to-LF bytes with any BOM preserved. Working inputs must match raw bytes or only CRLF/LF; NUL-containing or invalid UTF-8 bytes require exact equality. The source inventory excludes untracked/private/generated inputs; an explicitly supplied public-runtime reference is compared separately.',
  selfReference: { sourceCommitExcludes: followupPaths, followup: 'Subsequent documentation/verification-only commit; identify its SHA from Git history, never embed its own SHA in this manifest.' },
  fileCount: files.length,
  sourceIndexSha256: sha(Buffer.from(files.map((entry) => `${entry.path}\0${entry.sha256}\n`).join(''))),
  files,
  publicAssets,
};
const encoded = JSON.stringify(manifest, null, 2) + '\n';
if (write) writeFileSync(resolve(root, manifestPath), encoded);
else {
  if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error('Manifest differs from tracked source');
  const changed = git('diff', '--name-only', sourceCommit, 'HEAD').toString('utf8').trim().split('\n').filter(Boolean);
  if (changed.some((path) => !followupPaths.includes(path))) throw new Error('HEAD contains a non-documentation source change after the baseline');
}
console.log(JSON.stringify({ sourceCommit, files: files.length, binaries: publicAssets.filter((asset) => asset.kind === 'binary').length, textAssets: publicAssets.filter((asset) => asset.kind === 'utf8-text').length, sourceIndexSha256: manifest.sourceIndexSha256, manifestSha256: sha(Buffer.from(encoded)), mode: write ? 'write' : 'verify' }));
