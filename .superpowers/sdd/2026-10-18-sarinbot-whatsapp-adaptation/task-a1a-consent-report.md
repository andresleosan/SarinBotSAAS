# A1a implementation report

Status: implemented and focused validation passed; controller independent spec and quality review pending. This cut does not close A1 or authorize A1b or any deployment/activation.

Base: `c5845c8367400e339a36dff501c35189b47e9935`, branch `codex/restore-v24-20261020`, isolated source-restoration worktree. Review range is this BASE through the A1a commit carrying this report (`BASE..HEAD` at handoff); the exact resulting commit is supplied in the handoff. Initial tree was clean. No shared checkout or ALS mutation.

## Initial RED and provenance

Used test-driven-development and verification-before-completion skills. No production edit preceded the recorded RED or root acknowledgement. Private evidence root: `../evidence/a1a-consent/` (outside Git). All commands below ran from the isolated source through the new sanitized runner, using Node v24 and installed locked dependencies. The runner strips inherited credential/channel/runtime variables without printing values, sets telemetry off, CI and NO_COLOR, directs TEMP/TMP to sibling `../test-temp`, records argv/cwd/time/status and separate stdout/stderr. Vitest keeps source configuration, uses configLoader=runner, envDir=false, maxWorkers=4, disabled results cache and private external caches; failed test results explicitly propagate process exit 1.

Initial command:

```text
node ../evidence/a1a-consent/run.mjs initial-red ../evidence/a1a-consent/run-vitest.mjs initial-red tests/consent.test.ts tests/consent-operations.test.ts tests/consent-routes.test.ts tests/consent-ui.test.tsx
```

Exit 1: 4 files collected, 55 cases, 34 passed, 21 failed, 0 skipped. Preserved `initial-red.json`, `initial-red.stdout.log`, `initial-red.stderr.log`, `initial-red-results.json`. Observable failures: support schema rejected a valid support body; support GET/POST returned 400 instead of 200; unknown/repeated original query keys were accepted (200/404 instead of 400); support hook did not poll or expose status; actual scoped legal text was absent; frozen .1 receipts remained current/active. Existing service business-only branching threw on unbound support reads; support mutation returned schema rejection rather than the required legal 428 boundary. Two UI follow-on failures reached missing input/callback after support polling never started.

No setup/import/collection failure occurred. Test inspection corrected a latent ApiError constructor argument order and explicit-undefined default UID helper, and replaced cascading UI access with explicit missing-status/poll assertions. Repeated identical focused command under label `initial-semantic-red`: exit 1, same 4 files, 55 cases, 34 passed, 21 failed, 0 skipped, no collection errors. Its separate records are preserved. Root inspected those records and test-only diff and acknowledged RED before production edits.

Additional preproduction tests for support transaction/account revocation racing and unchanged commercial boundaries were recorded as `supplemental-red`: exit 1, 4 files, 57 cases, 34 passed, 23 failed, 0 skipped. First implementation run `green-focused`: exit 0, those 57 cases passed. `typecheck-first`: exit 0. Later final test additions strengthen busy/independent-choice, support withdrawal retry, late-read suppression and old-consent denial coverage; no production changes followed the first green implementation.

Historical fixture `tests/fixtures/consent-2026-10-18.1.ts` was frozen before production changes from `git show c5845c8367400e339a36dff501c35189b47e9935:src/lib/legal.ts`. The private `freeze-fixtures.cjs` transpiles/evaluates that pure historical literal and applies a separately written canonical SHA-256, never importing current consentDocuments. It writes static documents only. Synthetic receipt/state fixtures are independently assembled by tests from those documents. Freeze command exited 0 (`freeze-fixtures` records). Existing published pins are retained and rehashed independently as historical expectations:

- Account: `0266cade348f0cea94ea79d38d69f8a597e36d19dcdce7ddceab8caef575fcb7`.
- Synthetic named business: `38e87d63418d061441185236b26fd5a88f19ee0e4ae319cf24df053ee816da11`.

No private receipt extraction, synthetic automatic support opt-in or current-builder reconstruction of old documents occurred.

## Implemented behavior and exact surface

Exactly six production files:

- `src/lib/legal.ts`: adds platform_support and publishes .2, with separate support terms/privacy/notice/choices/purposes and business:null. Discloses Firebase identity, conditional YCloud transport, Workers AI Whisper transcription and DeepSeek support assistance, encrypted channel content/contact <=24h, minimum control <=30days, raw audio memory-only and separate legal receipt retention. Existing account/business service text and contact literals remain unchanged; the global version updates their current fingerprints.
- `src/lib/server/consent.ts`: extends scope schema/state; support acceptance checks current account consent in the same transaction before writes. Account alone uses proof/profile creation. Support withdrawal is independent and allowed after account withdrawal. Existing replay/revision/current-document checks and immutable history verification remain in place.
- `src/app/api/consent/route.ts`: extends GET scope and validates original query keys, rejecting duplicates/unknown keys. Absent scope defaults to account; account/support forbid businessId; business still requires it. UID remains sourced from requireUser before body/storage work; no support business read.
- `src/hooks/useConsent.ts`: enables support polling with UID and includes scope in identity while binding business fields only for business scope. Existing stable retries, abort/masking guards, withdrawal latch and 409/428 refresh stay intact. Support sends no businessId or account proof.
- `src/components/consent-panel.tsx`: exposes actual status.documents terms/privacy in labelled expandable content; support has its own document labels and withdrawal consequences. Account/business links remain. Choice form resets for scope/fingerprint/revision; both choices begin unchecked and blocked/busy still gate submission. Downloads continue to serialize the saved receipt.
- `shared/platform-whatsapp-authorization.ts`: only the exact exported ConsentAnchor and PlatformActor types from the brief, no runtime helper or extra fields. Compile checks cover exact shapes and reject nullable receipt anchors.

Exactly five test/fixture files: `tests/consent.test.ts`, `tests/consent-operations.test.ts`, `tests/consent-routes.test.ts`, `tests/consent-ui.test.tsx`, `tests/fixtures/consent-2026-10-18.1.ts`. This report is the only additional tracked documentation output. No config, package/lock, dependency junction, polling-internal, commercial service, legal-page, Worker or protocol change.

Coverage proves missing/revoked/obsolete account consent blocks support before writes, transactional revocation racing fails closed, both true choices and current documents/revisions are needed, no support proof/profile/business write occurs, UID/scope isolation and unchanged commercial gates hold, and replay never restores a revoked or later reaccepted state. Frozen .1 documents remain readable/downloadable and hash-verified; obsolete anchors retain their revision/fingerprint/non-null receipt ID while inactive; missing anchors have null receipt IDs; tampered historical content fails 503. Reading and accepting .2 leave the exact original persisted receipt and row version unchanged.

## Final validation

After the last meaningful test edit:

```text
node ../evidence/a1a-consent/run.mjs final-focused ../evidence/a1a-consent/run-vitest.mjs final-focused tests/consent.test.ts tests/consent-operations.test.ts tests/consent-routes.test.ts tests/consent-ui.test.tsx tests/booking-subject-consent.test.ts tests/booking-subject-consent-route.test.ts tests/booking-subject-consent.test.tsx
node ../evidence/a1a-consent/run.mjs final-typecheck node_modules/typescript/bin/tsc --noEmit
git diff --check
```

All exit 0. Focused: 7 files, 68 cases, 68 passed, 0 failed, 0 skipped. Per file: consent 24; consent operations 8; consent routes 14; consent UI 14; subject consent service 5; subject route 1; subject UI 2. Typecheck stdout/stderr empty. Private records: `final-focused.{json,stdout.log,stderr.log}`, `final-focused-results.json`, `final-typecheck.{json,stdout.log,stderr.log}`.

Warnings preserved: 16 react-test-renderer deprecation emissions in final focused stderr, no act-cleanup warnings. Git also reported its existing LF-to-CRLF policy for the three newly added files when staged; no line-ending/configuration change was made. No warning suppression, dependency migration or new skips. No full app/Worker/build/ALS/oracle, browser/server/emulator/network/provider/authentication/configuration/activation operation was performed. Existing P0 gates remain standing.

## Concerns and limits

No known scoped implementation blocker. This is a synthetic consent/contracts cut, not evidence of working live WhatsApp support. The new legal disclosures describe the approved conditional future functions and retention obligations; this cut implements no provider operation, channel retention system, PlatformActor authorization, links, ingress, jobs, audio, sending or enabling configuration. Durable link collisions/cleanup and later A1/P2 gates remain outside this cut. Global .2 intentionally requires fresh explicit current decisions for prior .1 account/business users; no automatic migration or historical receipt deletion is introduced. Controller independent review remains required before accepting A1a or continuing A1b.
