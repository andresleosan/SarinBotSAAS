# P0-R0 source assembly evidence

Date: 2026-10-20 (America/Bogota). Status: **DONE_WITH_CONCERNS** for bounded R0 only. **P0 remains incomplete; the candidate is not a restored or validated v24 baseline.**

Candidate branch: `codex/restore-v24-20261020`. BASE: `a59124731c2dcabfd7945359b0679d48a2560e70`. Production authority remains the exact recovered Container v24 and Worker 70 described in the package evidence; a591 is a modern source scaffold.

## Assembly and provenance

Copied eight historical original modules without editing from package `reference/Sarin-local-build-source`. Reference manifest SHA-256: `09b77025e55cb9c512a5889b81f3ddb3f196e49691d725c74f2293122bead7a9`. Every source and copied destination matched its reference manifest. These bytes are recovered local sourcesContent, not proof of complete current production parity.

| Copied original source | SHA-256 | Reason |
| --- | --- | --- |
| `src/lib/server/whatsapp-conversations.ts` | `7d85cdd1ffca4fcb3059fd553c4ad17b0c7eff0981831d1aba1b8fb1519ef917` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/app/admin/assistant/page.tsx` | `574075faba84667e67e2b76abc4f7e8761f38307d4471cd547d13cf0a44f2e14` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/components/admin-copilot.tsx` | `238f032bf3ce03a38f84d46bff4f16769bd1faab60dbe3a158c20b5aa89195e8` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/components/admin-whatsapp-conversations.tsx` | `e8334547a8233b70b253e286e74a1ccf73930c1cc67218f5740cadac690fdb55` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/app/api/admin/whatsapp/conversations/route.ts` | `2a8bb9953d545ff6bc7b68782483bc390b95d043db8d6a2f83641b192e713f63` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/app/api/admin/copilot/route.ts` | `2a82f0abe4b0670df746d4e57479b86d911af977dd439ca98429ed35e27ee038` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/lib/server/admin-copilot-rate.ts` | `8e6c2b9051221a9eb0ee02ba5b8bb34f45a27abec2f0dbd1b520ff9ba72a4235` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |
| `src/lib/server/admin-copilot.ts` | `3dc8a6808716700eff430db997390595a2b7bcdb07890238289d24bd7bf8adf5` | Original sourcesContent recovered without editing; see the reference manifest for exact source-map provenance. |

Copied only the following surviving contract types and focused tests from the shared checkout. Existing src/types/whatsapp.ts is the sole overwritten a591 file: its existing binding/usage declarations are retained and conversation declarations are added by the surviving original file. It is not one of the 35 historical source variants. The other fourteen files were absent from a591. Types and tests are surviving source, not reconstructed from compiled bundles.

| Surviving file | SHA-256 | Why needed |
| --- | --- | --- |
| `src/types/admin-copilot.ts` | `5274c74cf836a158d90f21ddc7145bfa90bfd830d4b7a34cab415bc94a7269c8` | Required shared client/server snapshot, answer, source, attention and coverage contracts imported by recovered copilot modules. |
| `src/types/whatsapp.ts` | `6ed34534df385f483ba10a766bd8bcdaf54ec8e0bb2c50be4bdeb07bce8d9dd1` | Required conversation mode, list and item contracts imported by recovered conversation server and UI; retains the prior binding and usage contracts. |
| `tests/admin-copilot-ui.test.tsx` | `909fb0f233c0fbf84f8b4b3781635ef7593e8ab37e0a2ae2481bf4da907b293f` | Synthetic copilot rendering, scope selection, request lifecycle, error and administrative access checks. |
| `tests/admin-copilot.test.ts` | `ab0c4a7a99c3bda827cd52d4c3389da7be6b0380855557343c83ac38486fd4f9` | Synthetic authenticated GET/POST, bounded reads, private-field exclusion, grounded output, duplicate requests and durable rate-limit checks. |
| `tests/admin-deep-links.test.ts` | `3ce1eaf95abd58d1bf4a1d2714f8340e50e06966acd1e7e092ff656f71618992` | Synthetic administrative payment destination contract linked from recovered copilot sources; preserves evidence of the unreconciled admin route variant. |
| `tests/admin-whatsapp-conversations.test.tsx` | `67ee03ab55be53ce9f552e4ddd901f0f6c04ba4eb248bda21309000f3a572e6f` | Synthetic conversation takeover/release, revision conflicts, loading/error and content availability checks. |
| `tests/whatsapp-conversation-routes.test.ts` | `381726c1810535202744ec5cdaf18968c5a6843354b06f740946f672a7a21d29` | Synthetic authorization, bounded conversation listing, revision control, invalid input and signed app-echo boundary checks. |

The five copied tests were read before copying. Their data is synthetic: fixture businesses, local.invalid/example.test requests, mock identities, in-memory database records, generated keys and mocked providers. No real contact records, exported conversations, ALS data, secrets or configuration files were copied. Existing tests/memoryFirestore.ts, tests/whatsapp-fixtures.ts and tests/server-only.ts remain a591 originals; the WhatsApp fixture is LF-equivalent to shared, and the a591 memory fixture has stronger snapshot/query support than the shared version, so neither was overlaid.

## Preserved source and manifest

`qa/source-restoration-r0/candidate-manifest.json` inventories all 778 a591-plus-assembly candidate input files with exact SHA-256, plus original/surviving provenance, retained support hashes and each of the 35 preserved historical variant hashes. `candidate-base-files.json` preserves the original 764-file worktree inventory. Generated QA evidence/documents and ignored local junctions/caches are outside the source input manifest.

Assembly verification: 8 original modules, 7 surviving type/test files, 35 unchanged historical variants; all 763 other a591 files retain their initial bytes. No existing historical variant, app implementation, Worker code, integration configuration or lockfile was changed.

Shared checkout preservation was checked before and after the runners using read-only Git status and tracked-diff hashes plus hashes of every copied survivor, fixture supports, package/lockfile and installed runner inputs. GIT_OPTIONAL_LOCKS=0 was used for shared Git reads. The hashes and status match; see shared-before.json and assembly-verification.json. This verifies the enumerated inputs and Git state; it is not a hash of every file inside shared node_modules. No tool installed or edited shared dependencies, and caches were explicitly kept in this candidate.

## Runners and commands

Node v24.22.0; installed TypeScript 5.9.3; Vitest 5.0.4. pnpm 11.23.0 remains the required manager, but pnpm is absent from PATH. The authorized direct Node runners reused existing locked dependencies without installation. Candidate-only junctions: node_modules -> E:/Proyectos/Sarin Bot/node_modules and cloudflare/node_modules -> E:/Proyectos/Sarin Bot/cloudflare/node_modules. No shared node_modules link or package contents were changed.

Orchestrator: `node qa/source-restoration-r0/run-baseline.mjs` (exit 1 because checks failed). It runs the following exact commands from the candidate root:

| Command | Exit status | Logs |
| --- | --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | 2 | `qa/source-restoration-r0/typecheck.stdout.log`, `qa/source-restoration-r0/typecheck.stderr.log` |
| `node qa/source-restoration-r0/run-vitest.mjs` | 1 | `qa/source-restoration-r0/vitest.stdout.log`, `qa/source-restoration-r0/vitest.stderr.log` |

run-vitest.mjs invokes installed startVitest in run mode with the unchanged candidate vitest.config.mts, four workers, default + JSON reporters, disabled results cache, candidate-local module/Vite caches and configLoader=runner. envDir=false prevents loading local environment files. TEMP/TMP are candidate-local; CI=true, NO_COLOR=1 and NEXT_TELEMETRY_DISABLED=1. No tests were weakened, filtered out, added empty, retried into success or repaired. Existing skipped tests remain visible.

Latest full baseline: **TypeScript exit 2; Vitest exit 1**. Test files: 16 failed, 140 passed, 4 skipped (160). Tests: 46 failed, 1565 passed, 41 skipped (1652). This baseline is red.

The initial attempt also ran the full baseline before the candidate Cloudflare junction existed. It reported 16 failed / 140 passed / 4 skipped files and 46 failed / 1565 passed / 41 skipped tests, predominantly unresolved wrangler. All first-attempt logs, exact statuses and the JSON reporter are preserved under attempt-1/. The existing Cloudflare dependency directory was then junctioned locally and the complete baseline rerun; no dependencies were installed. An initial read-only shared Git inventory was rejected for ownership; command-local safe.directory was used subsequently, with no global Git configuration change. The initial `pnpm --version` check failed because pnpm is not on PATH.

### Focused synthetic tests in the full baseline

| Test file | Passed | Failed | Skipped |
| --- | --- | --- | --- |
| `tests/admin-copilot-ui.test.tsx` | 11 | 0 | 0 |
| `tests/admin-copilot.test.ts` | 20 | 1 | 0 |
| `tests/admin-deep-links.test.ts` | 3 | 5 | 0 |
| `tests/admin-whatsapp-conversations.test.tsx` | 8 | 0 | 0 |
| `tests/whatsapp-conversation-routes.test.ts` | 3 | 2 | 0 |

### TypeScript diagnostics

```text
src/lib/client/booking-card-assets.ts(90,40): error TS2307: Cannot find module 'pdf-lib' or its corresponding type declarations.
src/lib/server/admin-copilot.ts(101,128): error TS2322: Type '"sarin_admin_copilot"' is not assignable to type '"sarin_client" | "sarin_onboarding" | "sarin_owner_copilot"'.
tests/booking-card-assets.test.ts(2,52): error TS2307: Cannot find module 'pdf-lib' or its corresponding type declarations.
tests/booking-card-assets.test.ts(35,70): error TS7031: Binding element 'value' implicitly has an 'any' type.
```

The missing pdf-lib dependency is an existing reused-dependency limitation; no install is authorized. The copilot mode error comes from the retained a591 src/lib/server/ai-usage.ts schema, one of the 35 historical variants. Adding its behavior or changing the recovered module is outside R0.

The final failure groups are: missing pdf-lib import; incomplete copilot usage ledger, focused admin payment links and WhatsApp conversation metadata/echo behavior in retained core variants; local Miniflare/Workerd D1 internal errors (exact reference IDs in logs); and migration backup protection. Two migration backup fixtures report MIGRATION_BACKUP_INSIDE_WORKSPACE because R0 keeps TEMP/TMP inside this candidate. These results are retained, with no environmental or core repair after the final baseline. pdf-lib is locked at 1.17.1; the reused root node_modules has no pdf-lib link and its .pnpm store has no matching package directory. The conventional local pnpm/store directory is also absent. This is a bounded read-only availability check, not a claim about every possible machine cache.

### Failed test files

| File | Failed assertions | Collected assertions |
| --- | --- | --- |
| `tests/admin-copilot.test.ts` | 1 | 21 |
| `tests/admin-deep-links.test.ts` | 5 | 8 |
| `tests/appointment-reminders.integration.test.ts` | 8 | 8 |
| `tests/appointment-reschedule.integration.test.ts` | 8 | 8 |
| `tests/booking-card-assets.test.ts` | 0 | 0 |
| `tests/business-ai-budget.integration.test.ts` | 2 | 2 |
| `tests/cloudflare-data.integration.test.ts` | 0 | 10 |
| `tests/data-migration.test.ts` | 4 | 21 |
| `tests/inference-rate-limit.test.ts` | 1 | 20 |
| `tests/next-availability-d1.integration.test.ts` | 0 | 1 |
| `tests/pilot-abuse.integration.test.ts` | 0 | 2 |
| `tests/reminder-data-maintenance.test.ts` | 3 | 10 |
| `tests/represented-booking.integration.test.ts` | 4 | 4 |
| `tests/waitlist-d1.test.ts` | 7 | 7 |
| `tests/waitlist-data-maintenance.test.ts` | 1 | 11 |
| `tests/whatsapp-conversation-routes.test.ts` | 2 | 5 |

Exact assertion names, failure messages, import/hook failures and stacks are preserved in failures.json, vitest-results.json and vitest.stderr.log. Zero failed assertions in a failed file indicates import/suite setup failure, not a passing file. Do not treat JSON nested-suite counters as file counters; baseline-summary.json counts testResults for file totals.

## Exact remaining P0 gaps

- Reconcile all 35 historical existing source variants against the exact v24/Worker evidence; their original candidate a591 bytes are preserved. This includes the ai-usage copilot mode, admin payment deep links, WhatsApp store conversation metadata/human echoes, engine/prompt/schema/business/quota/billing and UI/client deltas. Focus failures are evidence of this incomplete integration.
- Reconstruct the four missing source routes: src/app/api/admin/platform-whatsapp/conversations/route.ts; src/app/api/admin/platform-whatsapp/retry-diagnostic/route.ts; src/app/api/admin/platform-whatsapp/status/route.ts; src/app/api/whatsapp/ycloud/platform/webhook/route.ts.
- Recover the platform shared contract/types and helpers, whose original filenames are not proven: candidate shared/platform-whatsapp.ts and src/types/platform-whatsapp.ts; platform-whatsapp-config.ts; platform-whatsapp-store.ts; platform-whatsapp-crypto.ts; ycloud-webhook.ts; ycloud-retry-diagnostic.ts; platform-whatsapp-ingress.ts; platform-whatsapp-conversations.ts under src/lib/server, plus the platform status/control addition in admin/assistant.
- Restore Worker isPlatformWhatsApp* validators, cleanupPhase and cleanupPlatformWhatsAppRetention, scheduled invocation/guards and configuration bridge; reconcile cloudflare/src/index.ts, worker-configuration.d.ts, public wrangler configuration, shared/data-protocol.ts and Database/D1 integration against evidence. No bindings or secret values are included.
- Apply and compare exact visible SarinBot branding, public contact helper/consumers, metadata/manifest, legal and billing text, prompts and runtime public assets, including modules without proven historical filenames. Historical copied modules still contain their original older presentation strings.
- Complete local parity checks for authentication, response contracts, revisions/state controls, scope filtering, duplicates/conflicts, encryption/retention and pause/disconnect, then complete the final source manifest before closing P0. R0 does not establish deployment parity, real coexistence/receipt or retryCompatible; P1 remains separate.
- Resolve reused dependency availability and rerun required checks only in an authorized later task. No build/deploy, merge, push, ALS work or production action occurred in R0.

Preserved constraints for later restoration: WhatsApp Business App coexistence and SarinBot own channel in YCloud Free; encrypted contact/content up to 24 hours and minimal control metadata up to 30 days (legal records separately); raw audio processed in memory only; one application instance; no permanent keepalive, reload or plan upgrade; exact visible name SarinBot and engine only under alsdevstudio.com; signature tolerance remains ±300 seconds; AI/send off by default. No new diagnostic application code was added.

## Recheck

`node qa/source-restoration-r0/verify-assembly.mjs` exits 0 only when the assembled inputs, retained a591 files/variants and checked shared state match the recorded hashes. assemble.mjs is a one-time guarded assembly script requiring the original BASE and absent destination originals; do not rerun it on the committed candidate. run-baseline.mjs may rerun the existing checks and overwrite latest log paths; preserve previous attempt evidence first when needed.
