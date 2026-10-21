# P0-R1 core source restoration — 2026-10-20

Status: **DONE_WITH_CONCERNS** for this bounded restoration. P0 is incomplete and this candidate is not deployable. Base: 85adaba86f6b54f9ea865ce46018ae252295bc28.

## Restored behavior

- Restored exact surviving bytes for WhatsApp store, application WhatsApp worker and admin payment route after checking pinned source hashes and v24 branches. Store module 80288 and worker module 45244 have exact historical module-body matches.
- Added the administrative copilot usage mode while retaining shared modern tariffs.
- Restored the modern chat handoff wrapper: cancelled replies release quota and cannot replay from memory; saved appointments retain accounting; ambiguous writes remain recoverable.
- Restored payment deep links, one-time focus, receipt/business anchors and assistant navigation while retaining budget, policy, invitation and consent controls.

The 35-file audit retains 28 a591 variants, copies three originals and reconstructs four small deltas. It covers source bytes, historical source maps and current module branches, not complete compiled equivalence. Detailed treatment table, all source/runtime hashes, 118 verified historical artifact reads, branch evidence and raw logs remain outside Git in package evidence/p0-r1-core/.

## Validation

Node 24.22.0; controller-prepared private frozen pnpm 11.23.0 dependencies, including locked pdf-lib 1.17.1. No manifest or lockfile edits. TEMP/TMP was package test-temp outside this Git root for the full baseline.

| Check | Result |
| --- | --- |
| Existing focused RED | 8 failed / 26 passed; reproduced mode, payment and conversation gaps |
| Reconstructed chat RED | 2 failed / 19 passed; cancellation release and saved-mutation settlement |
| Reconstructed navigation RED | 2 failed; missing focused query and assistant destinations |
| Focused core GREEN | 79 passed |
| Focused UI GREEN | 26 passed |
| App-echo handoff/retention characterization | 16 passed |
| TypeScript: node node_modules/typescript/bin/tsc --noEmit --incremental false | Passed |
| Full Vitest, one baseline | 1 failed / 1635 passed / 28 skipped; 1 failed / 156 passed / 4 skipped files |
| Navigation correction, focused | 16 passed |

The full baseline's sole failure was tests/user-avatar.test.tsx, “Google account avatar keeps administration navigation focused on the commercial workspace”: its exact expected navigation omitted /admin/assistant. Updated that exact list to the v24 contract; the same test plus new focus tests then passed. No assertion was loosened or skipped. The complete suite was not repeated; its original red result is preserved in full-vitest-results.json and full-failures.json. TypeScript passed before this string-only test expectation change.

An initial new UI fixture failed on an unrelated Next Image URL because the test supplies a minimal window. The fixture now stubs branding, whose rendering is outside this test, and meaningful RED was observed before UI implementation. All attempt logs are retained. Existing react-test-renderer deprecation warnings remain visible.

## Outstanding P0 interfaces

- Four platform routes: admin platform-whatsapp conversations, retry-diagnostic, status; YCloud platform webhook.
- Platform configuration, encryption, ingress/signature parsing, conversation/control store, shared contracts and status UI; diagnostic observer remains separate.
- Worker platform validators, collection bridge, retention cleanup and scheduled guards; no Worker retention implementation was changed here.
- Exact SarinBot branding, public contact helpers/consumers, legal/prompt copy and assets, including visible copy in retained or partially restored variants.
- End-to-end local parity for authorization/revocation, scope/revisions, duplicates, encryption/retention and pause/disconnect, plus final source manifest.

No build, app-server execution, production operation, browser action, dependency installation, junction modification, merge or push occurred in this task. The controller supplied private dependency and frozen static evidence. The shared checkout and its historical artifacts were read only. No ALS records, secrets or real conversations were copied. This task adds no YCloud channel, keepalive, plan upgrade or replicas, and does not change signature tolerance, AI/send defaults, raw-audio policy or retired browser storage.
