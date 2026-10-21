import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = 'qa/source-restoration-r0';
const manifest = JSON.parse(readFileSync(`${dir}/candidate-manifest.json`, 'utf8'));
const commands = JSON.parse(readFileSync(`${dir}/baseline-commands.json`, 'utf8'));
const results = JSON.parse(readFileSync(`${dir}/vitest-results.json`, 'utf8'));
const verification = JSON.parse(readFileSync(`${dir}/assembly-verification.json`, 'utf8'));
const row = file => `| \`${file.path}\` | \`${file.sha256}\` | ${file.reason} |`;
const relative = file => file.replaceAll('\\', '/').split('/source-restoration/').at(-1);
const failures = results.testResults.filter(file => file.status === 'failed').map(file => ({
  path: relative(file.name), assertions: file.assertionResults.length,
  failed: file.assertionResults.filter(test => test.status === 'failed').map(test => ({ name: test.fullName, messages: test.failureMessages })),
  message: file.message,
}));
writeFileSync(`${dir}/failures.json`, JSON.stringify(failures, null, 2) + '\n');
const isSkippedFile = file => file.status !== 'failed' && file.assertionResults.length > 0 && file.assertionResults.every(test => ['skipped', 'pending'].includes(test.status));
const fileCounts = { total: results.testResults.length, failed: results.testResults.filter(file => file.status === 'failed').length, passed: results.testResults.filter(file => file.status === 'passed' && !isSkippedFile(file)).length, skipped: results.testResults.filter(isSkippedFile).length };
const focused = manifest.copiedSurvivors.filter(file => file.path.startsWith('tests/')).map(file => {
  const result = results.testResults.find(test => relative(test.name) === file.path);
  return { path: file.path, passed: result.assertionResults.filter(test => test.status === 'passed').length, failed: result.assertionResults.filter(test => test.status === 'failed').length, skipped: result.assertionResults.filter(test => ['pending', 'skipped'].includes(test.status)).length };
});
const summary = { fileCounts, tests: { total: results.numTotalTests, passed: results.numPassedTests, failed: results.numFailedTests, skipped: results.numPendingTests }, focused, commands: commands.records.map(({command,exitStatus})=>({command,exitStatus})), versions: Object.fromEntries(['typescript','vitest'].map(name=>[name,JSON.parse(readFileSync(`node_modules/${name}/package.json`,'utf8')).version])) };
writeFileSync(`${dir}/baseline-summary.json`, JSON.stringify(summary, null, 2) + '\n');
const lines = [
  '# P0-R0 source assembly evidence', '',
  'Date: 2026-10-20 (America/Bogota). Status: **DONE_WITH_CONCERNS** for bounded R0 only. **P0 remains incomplete; the candidate is not a restored or validated v24 baseline.**', '',
  `Candidate branch: \`${manifest.branch}\`. BASE: \`${manifest.base}\`. Production authority remains the exact recovered Container v24 and Worker 70 described in the package evidence; a591 is a modern source scaffold.`, '',
  '## Assembly and provenance', '',
  `Copied eight historical original modules without editing from package \`reference/Sarin-local-build-source\`. Reference manifest SHA-256: \`${manifest.referenceManifestSha256}\`. Every source and copied destination matched its reference manifest. These bytes are recovered local sourcesContent, not proof of complete current production parity.`, '',
  '| Copied original source | SHA-256 | Reason |', '| --- | --- | --- |', ...manifest.copiedOriginals.map(row), '',
  'Copied only the following surviving contract types and focused tests from the shared checkout. Existing src/types/whatsapp.ts is the sole overwritten a591 file: its existing binding/usage declarations are retained and conversation declarations are added by the surviving original file. It is not one of the 35 historical source variants. The other fourteen files were absent from a591. Types and tests are surviving source, not reconstructed from compiled bundles.', '',
  '| Surviving file | SHA-256 | Why needed |', '| --- | --- | --- |', ...manifest.copiedSurvivors.map(row), '',
  'The five copied tests were read before copying. Their data is synthetic: fixture businesses, local.invalid/example.test requests, mock identities, in-memory database records, generated keys and mocked providers. No real contact records, exported conversations, ALS data, secrets or configuration files were copied. Existing tests/memoryFirestore.ts, tests/whatsapp-fixtures.ts and tests/server-only.ts remain a591 originals; the WhatsApp fixture is LF-equivalent to shared, and the a591 memory fixture has stronger snapshot/query support than the shared version, so neither was overlaid.', '',
  '## Preserved source and manifest', '',
  `\`${dir}/candidate-manifest.json\` inventories all ${manifest.candidateFiles.length} a591-plus-assembly candidate input files with exact SHA-256, plus original/surviving provenance, retained support hashes and each of the 35 preserved historical variant hashes. \`candidate-base-files.json\` preserves the original 764-file worktree inventory. Generated QA evidence/documents and ignored local junctions/caches are outside the source input manifest.`, '',
  `Assembly verification: ${verification.originalFilesVerified} original modules, ${verification.survivingFilesVerified} surviving type/test files, ${verification.historicalVariantsPreserved} unchanged historical variants; all ${verification.baseFilesPreservedExceptAuthorizedWhatsAppType} other a591 files retain their initial bytes. No existing historical variant, app implementation, Worker code, integration configuration or lockfile was changed.`, '',
  'Shared checkout preservation was checked before and after the runners using read-only Git status and tracked-diff hashes plus hashes of every copied survivor, fixture supports, package/lockfile and installed runner inputs. GIT_OPTIONAL_LOCKS=0 was used for shared Git reads. The hashes and status match; see shared-before.json and assembly-verification.json. This verifies the enumerated inputs and Git state; it is not a hash of every file inside shared node_modules. No tool installed or edited shared dependencies, and caches were explicitly kept in this candidate.', '',
  '## Runners and commands', '',
  `Node ${commands.nodeVersion}; installed TypeScript ${summary.versions.typescript}; Vitest ${summary.versions.vitest}. pnpm 11.23.0 remains the required manager, but pnpm is absent from PATH. The authorized direct Node runners reused existing locked dependencies without installation. Candidate-only junctions: node_modules -> E:/Proyectos/Sarin Bot/node_modules and cloudflare/node_modules -> E:/Proyectos/Sarin Bot/cloudflare/node_modules. No shared node_modules link or package contents were changed.`, '',
  'Orchestrator: `node qa/source-restoration-r0/run-baseline.mjs` (exit 1 because checks failed). It runs the following exact commands from the candidate root:', '',
  '| Command | Exit status | Logs |', '| --- | --- | --- |',
  ...commands.records.map(entry=>`| \`${entry.command}\` | ${entry.exitStatus} | \`${entry.stdout}\`, \`${entry.stderr}\` |`), '',
  'run-vitest.mjs invokes installed startVitest in run mode with the unchanged candidate vitest.config.mts, four workers, default + JSON reporters, disabled results cache, candidate-local module/Vite caches and configLoader=runner. envDir=false prevents loading local environment files. TEMP/TMP are candidate-local; CI=true, NO_COLOR=1 and NEXT_TELEMETRY_DISABLED=1. No tests were weakened, filtered out, added empty, retried into success or repaired. Existing skipped tests remain visible.', '',
  `Latest full baseline: **TypeScript exit 2; Vitest exit 1**. Test files: ${fileCounts.failed} failed, ${fileCounts.passed} passed, ${fileCounts.skipped} skipped (${fileCounts.total}). Tests: ${summary.tests.failed} failed, ${summary.tests.passed} passed, ${summary.tests.skipped} skipped (${summary.tests.total}). This baseline is red.`, '',
  'The initial attempt also ran the full baseline before the candidate Cloudflare junction existed. It reported 16 failed / 140 passed / 4 skipped files and 46 failed / 1565 passed / 41 skipped tests, predominantly unresolved wrangler. All first-attempt logs, exact statuses and the JSON reporter are preserved under attempt-1/. The existing Cloudflare dependency directory was then junctioned locally and the complete baseline rerun; no dependencies were installed. An initial read-only shared Git inventory was rejected for ownership; command-local safe.directory was used subsequently, with no global Git configuration change. The initial `pnpm --version` check failed because pnpm is not on PATH.', '',
  '### Focused synthetic tests in the full baseline', '',
  '| Test file | Passed | Failed | Skipped |', '| --- | --- | --- | --- |',
  ...focused.map(file=>`| \`${file.path}\` | ${file.passed} | ${file.failed} | ${file.skipped} |`), '',
  '### TypeScript diagnostics', '', '```text', readFileSync(`${dir}/typecheck.stdout.log`,'utf8').trim(), '```', '',
  'The missing pdf-lib dependency is an existing reused-dependency limitation; no install is authorized. The copilot mode error comes from the retained a591 src/lib/server/ai-usage.ts schema, one of the 35 historical variants. Adding its behavior or changing the recovered module is outside R0.', '',
  'The final failure groups are: missing pdf-lib import; incomplete copilot usage ledger, focused admin payment links and WhatsApp conversation metadata/echo behavior in retained core variants; local Miniflare/Workerd D1 internal errors (exact reference IDs in logs); and migration backup protection. Two migration backup fixtures report MIGRATION_BACKUP_INSIDE_WORKSPACE because R0 keeps TEMP/TMP inside this candidate. These results are retained, with no environmental or core repair after the final baseline. pdf-lib is locked at 1.17.1; the reused root node_modules has no pdf-lib link and its .pnpm store has no matching package directory. The conventional local pnpm/store directory is also absent. This is a bounded read-only availability check, not a claim about every possible machine cache.', '',
  '### Failed test files', '',
  '| File | Failed assertions | Collected assertions |', '| --- | --- | --- |',
  ...failures.map(file=>`| \`${file.path}\` | ${file.failed.length} | ${file.assertions} |`), '',
  'Exact assertion names, failure messages, import/hook failures and stacks are preserved in failures.json, vitest-results.json and vitest.stderr.log. Zero failed assertions in a failed file indicates import/suite setup failure, not a passing file. Do not treat JSON nested-suite counters as file counters; baseline-summary.json counts testResults for file totals.', '',
  '## Exact remaining P0 gaps', '',
  '- Reconcile all 35 historical existing source variants against the exact v24/Worker evidence; their original candidate a591 bytes are preserved. This includes the ai-usage copilot mode, admin payment deep links, WhatsApp store conversation metadata/human echoes, engine/prompt/schema/business/quota/billing and UI/client deltas. Focus failures are evidence of this incomplete integration.',
  '- Reconstruct the four missing source routes: src/app/api/admin/platform-whatsapp/conversations/route.ts; src/app/api/admin/platform-whatsapp/retry-diagnostic/route.ts; src/app/api/admin/platform-whatsapp/status/route.ts; src/app/api/whatsapp/ycloud/platform/webhook/route.ts.',
  '- Recover the platform shared contract/types and helpers, whose original filenames are not proven: candidate shared/platform-whatsapp.ts and src/types/platform-whatsapp.ts; platform-whatsapp-config.ts; platform-whatsapp-store.ts; platform-whatsapp-crypto.ts; ycloud-webhook.ts; ycloud-retry-diagnostic.ts; platform-whatsapp-ingress.ts; platform-whatsapp-conversations.ts under src/lib/server, plus the platform status/control addition in admin/assistant.',
  '- Restore Worker isPlatformWhatsApp* validators, cleanupPhase and cleanupPlatformWhatsAppRetention, scheduled invocation/guards and configuration bridge; reconcile cloudflare/src/index.ts, worker-configuration.d.ts, public wrangler configuration, shared/data-protocol.ts and Database/D1 integration against evidence. No bindings or secret values are included.',
  '- Apply and compare exact visible SarinBot branding, public contact helper/consumers, metadata/manifest, legal and billing text, prompts and runtime public assets, including modules without proven historical filenames. Historical copied modules still contain their original older presentation strings.',
  '- Complete local parity checks for authentication, response contracts, revisions/state controls, scope filtering, duplicates/conflicts, encryption/retention and pause/disconnect, then complete the final source manifest before closing P0. R0 does not establish deployment parity, real coexistence/receipt or retryCompatible; P1 remains separate.',
  '- Resolve reused dependency availability and rerun required checks only in an authorized later task. No build/deploy, merge, push, ALS work or production action occurred in R0.', '',
  'Preserved constraints for later restoration: WhatsApp Business App coexistence and SarinBot own channel in YCloud Free; encrypted contact/content up to 24 hours and minimal control metadata up to 30 days (legal records separately); raw audio processed in memory only; one application instance; no permanent keepalive, reload or plan upgrade; exact visible name SarinBot and engine only under alsdevstudio.com; signature tolerance remains ±300 seconds; AI/send off by default. No new diagnostic application code was added.', '',
  '## Recheck', '',
  '`node qa/source-restoration-r0/verify-assembly.mjs` exits 0 only when the assembled inputs, retained a591 files/variants and checked shared state match the recorded hashes. assemble.mjs is a one-time guarded assembly script requiring the original BASE and absent destination originals; do not rerun it on the committed candidate. run-baseline.mjs may rerun the existing checks and overwrite latest log paths; preserve previous attempt evidence first when needed.', '',
];
mkdirSync('docs/qa', { recursive: true });
writeFileSync('docs/qa/2026-10-20-source-restoration-r0.md', lines.join('\n'));
writeFileSync('.superpowers/sdd/2026-10-18-sarinbot-whatsapp-adaptation/task-p0-r0-report.md', '# Task P0-R0 report\n\nStatus: DONE_WITH_CONCERNS\n\nCommit IDs: pending candidate commit.\n\n' + lines.join('\n'));
console.log(JSON.stringify(summary, null, 2));

