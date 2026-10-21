import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const evidence = resolve('qa/source-restoration-r0');
const shared = 'E:/Proyectos/Sarin Bot';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hash = path => digest(readFileSync(path));
const git = (...args) => execFileSync('git', ['-c', 'safe.directory=E:/Proyectos/Sarin Bot', '-C', shared, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
const before = JSON.parse(readFileSync(resolve(evidence, 'shared-before.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(resolve(evidence, 'candidate-manifest.json'), 'utf8'));
const baseFiles = JSON.parse(readFileSync(resolve(evidence, 'candidate-base-files.json'), 'utf8'));
const after = {
  statusSha256: digest(git('status', '--porcelain=v1', '-uall')),
  trackedDiffSha256: digest(git('diff', '--no-ext-diff', '--binary', 'HEAD')),
  files: before.files.map(file => ({ path: file.path, sha256: hash(resolve(shared, file.path)) })),
};
const issues = [];
if (JSON.stringify(before) !== JSON.stringify(after)) issues.push('Shared status, tracked diff or checked input files changed');
for (const file of manifest.candidateFiles) if (hash(resolve(root, file.path)) !== file.sha256) issues.push(`Candidate differs from assembly: ${file.path}`);
for (const file of baseFiles) if (file.path !== 'src/types/whatsapp.ts' && hash(resolve(root, file.path)) !== file.sha256) issues.push(`Unapproved BASE change: ${file.path}`);
for (const file of manifest.retainedHistoricalVariants) if (hash(resolve(root, file.path)) !== file.candidateSha256) issues.push(`Historical variant changed: ${file.path}`);
const result = { sharedUnchanged: JSON.stringify(before) === JSON.stringify(after), sharedAfter: after, originalFilesVerified: manifest.copiedOriginals.length, survivingFilesVerified: manifest.copiedSurvivors.length, candidateFilesVerified: manifest.candidateFiles.length, historicalVariantsPreserved: manifest.retainedHistoricalVariants.length, baseFilesPreservedExceptAuthorizedWhatsAppType: baseFiles.length - 1, issues };
writeFileSync(resolve(evidence, 'assembly-verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, sharedAfter: undefined }, null, 2));
process.exitCode = issues.length ? 1 : 0;
