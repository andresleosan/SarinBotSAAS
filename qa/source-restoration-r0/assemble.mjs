import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';

const root = process.cwd();
const evidence = resolve(root, 'qa/source-restoration-r0');
const reference = resolve(root, '../reference/Sarin-local-build-source');
const shared = 'E:/Proyectos/Sarin Bot';
const base = 'a59124731c2dcabfd7945359b0679d48a2560e70';
const digest = value => createHash('sha256').update(value).digest('hex');
const hash = file => digest(readFileSync(file));
const git = (cwd, ...args) => execFileSync('git', ['-c', 'safe.directory=E:/Proyectos/Sarin Bot', '-C', cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });
const manifest = JSON.parse(readFileSync(resolve(reference, 'manifest.json'), 'utf8'));
const scope = JSON.parse(readFileSync(resolve(root, '../evidence/source-reconstruction-scope.json'), 'utf8'));
const reasons = {
  'src/types/admin-copilot.ts': 'Required shared client/server snapshot, answer, source, attention and coverage contracts imported by recovered copilot modules.',
  'src/types/whatsapp.ts': 'Required conversation mode, list and item contracts imported by recovered conversation server and UI; retains the prior binding and usage contracts.',
  'tests/admin-copilot-ui.test.tsx': 'Synthetic copilot rendering, scope selection, request lifecycle, error and administrative access checks.',
  'tests/admin-copilot.test.ts': 'Synthetic authenticated GET/POST, bounded reads, private-field exclusion, grounded output, duplicate requests and durable rate-limit checks.',
  'tests/admin-deep-links.test.ts': 'Synthetic administrative payment destination contract linked from recovered copilot sources; preserves evidence of the unreconciled admin route variant.',
  'tests/admin-whatsapp-conversations.test.tsx': 'Synthetic conversation takeover/release, revision conflicts, loading/error and content availability checks.',
  'tests/whatsapp-conversation-routes.test.ts': 'Synthetic authorization, bounded conversation listing, revision control, invalid input and signed app-echo boundary checks.',
};
if (git(root, 'rev-parse', 'HEAD').toString().trim() !== base) throw new Error('Candidate HEAD differs from required BASE');
if (git(root, 'branch', '--show-current').toString().trim() !== 'codex/restore-v24-20261020') throw new Error('Wrong candidate branch');
if (manifest.files.length !== 8 || hash(resolve(reference, 'manifest.json')) !== '09b77025e55cb9c512a5889b81f3ddb3f196e49691d725c74f2293122bead7a9') throw new Error('Unexpected reference manifest');
const originals = manifest.files.map(file => ({ path: file.relativePath, origin: 'reference/Sarin-local-build-source', sha256: file.sourceSha256, reason: 'Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance.' }));
const survivors = Object.entries(reasons).map(([path, reason]) => ({ path, origin: shared, sha256: hash(resolve(shared, path)), reason }));
for (const file of [...originals, ...survivors]) {
  const source = resolve(file.origin === shared ? shared : reference, file.path);
  if (hash(source) !== file.sha256) throw new Error(`Source hash mismatch: ${file.path}`);
  const inventory = scope.survivingNewFocusSourcesAndTests.find(entry => entry.relativePath === file.path);
  if (inventory && inventory.sha256 !== file.sha256) throw new Error(`Surviving scope hash mismatch: ${file.path}`);
}
const candidateBaseFiles = git(root, 'ls-files', '-z').toString().split('\0').filter(Boolean).map(path => ({ path, sha256: hash(resolve(root, path)) }));
const variants = scope.olderLocalBuild.changedExistingSourceFiles.map(file => {
  const path = file.relativePath;
  const candidate = readFileSync(resolve(root, path));
  const original = git(root, 'show', `${base}:${path}`);
  if (digest(candidate.toString().replaceAll('\r\n', '\n')) !== digest(original.toString().replaceAll('\r\n', '\n'))) throw new Error(`Variant not at BASE: ${path}`);
  return { path, candidateSha256: digest(candidate), baseGitBytesSha256: digest(original), retainedAtBase: true };
});
if (variants.length !== 35) throw new Error('Expected exactly 35 retained historical variants');
const sharedReadPaths = [...new Set([...survivors.map(file => file.path), 'pnpm-lock.yaml', 'package.json', 'tests/memoryFirestore.ts', 'tests/whatsapp-fixtures.ts', 'node_modules/typescript/bin/tsc', 'node_modules/typescript/package.json', 'node_modules/vitest/vitest.mjs', 'node_modules/vitest/package.json', 'node_modules/vite/package.json'])];
const sharedSnapshot = {
  statusSha256: digest(git(shared, 'status', '--porcelain=v1', '-uall')),
  trackedDiffSha256: digest(git(shared, 'diff', '--no-ext-diff', '--binary', 'HEAD')),
  files: sharedReadPaths.map(path => ({ path, sha256: hash(resolve(shared, path)) })),
};
writeFileSync(resolve(evidence, 'shared-before.json'), JSON.stringify(sharedSnapshot, null, 2) + '\n');
writeFileSync(resolve(evidence, 'candidate-base-files.json'), JSON.stringify(candidateBaseFiles, null, 2) + '\n');
for (const file of [...originals, ...survivors]) {
  const destination = resolve(root, file.path);
  if (file.origin !== shared && existsSync(destination)) throw new Error(`Original unexpectedly already exists: ${file.path}`);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(file.origin === shared ? shared : reference, file.path), destination);
  if (hash(destination) !== file.sha256) throw new Error(`Candidate hash mismatch: ${file.path}`);
}
for (const file of variants) if (hash(resolve(root, file.path)) !== file.candidateSha256) throw new Error(`Variant was modified: ${file.path}`);
const assembly = {
  schemaVersion: 1, base, branch: 'codex/restore-v24-20261020',
  referenceManifestSha256: hash(resolve(reference, 'manifest.json')),
  copiedOriginals: originals, copiedSurvivors: survivors, retainedHistoricalVariants: variants,
  retainedFixtureSupport: ['tests/memoryFirestore.ts', 'tests/whatsapp-fixtures.ts', 'tests/server-only.ts'].map(path => ({ path, sha256: hash(resolve(root, path)), reason: 'Existing a591 synthetic support; preserved rather than overlaid from shared checkout.' })),
  candidateFiles: [...new Set([...candidateBaseFiles.map(file => file.path), ...originals.map(file => file.path), ...survivors.map(file => file.path)])].sort().map(path => ({ path, sha256: hash(resolve(root, path)) })),
  limits: 'Source assembly only. Exact original source is historical evidence, not proof of deployed v24 parity. P0 remains incomplete. QA artifacts and ignored local dependency junction/caches are outside candidateFiles.',
};
writeFileSync(resolve(evidence, 'candidate-manifest.json'), JSON.stringify(assembly, null, 2) + '\n');
console.log(`Copied and verified ${originals.length} originals and ${survivors.length} surviving contracts/tests. Retained ${variants.length} BASE variants. Manifest inventories ${assembly.candidateFiles.length} candidate files.`);

