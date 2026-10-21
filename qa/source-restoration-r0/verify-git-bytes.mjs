import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const manifest = JSON.parse(readFileSync('qa/source-restoration-r0/candidate-manifest.json', 'utf8'));
const revision = process.argv[2] ?? 'HEAD';
const mismatches = [];
for (const file of [...manifest.copiedOriginals, ...manifest.copiedSurvivors]) {
  const bytes = execFileSync('git', ['show', `${revision}:${file.path}`]);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== file.sha256) mismatches.push(file.path);
}
console.log(JSON.stringify({ revision, verifiedCopiedFiles: 15, mismatches }, null, 2));
process.exitCode = mismatches.length ? 1 : 0;
