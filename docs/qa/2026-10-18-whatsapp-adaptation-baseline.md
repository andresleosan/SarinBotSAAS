# WhatsApp adaptation restoration baseline

Recorded 21 October 2026, America/Bogota. The filename follows the approved 18 October coordinator plan. This is the restored source baseline submitted for independent P0 review; it does not close P0 or authorize deployment or automation.

## Source and immutable authority

- Private package: `C:/Users/Drean Skate/AppData/Local/SarinBot/whatsapp-adaptation-20261020`; source: `source-restoration`; branch: `codex/restore-v24-20261020`. The dirty shared checkout is separate. Git worktree/common objects reside in the original repository; private operational material remains outside Git.
- Exact source commit: `8d0b7702f1d1f5694ff8ca930657a2280e2ce04a`; tree: `68f4bf86739cd33737d9a90e548e6afbca0aa9f4`. R6 dispatch BASE is `cc4cd5a80d37e37b75caf0c0c926027ad1b42dac`. The intervening commit changes only three stale booking test labels to the published `Hablar con SarinBot`.
- Publication authority: recovered Container v24 image digest `sha256:366e5f34cef1e08735ffaf15a5a55189a1c4e6bd086a564dedf1ad59aac3404a` and Worker70 version `076575f2-5e93-41be-ba2b-1eddd64d574b`. The a591 source is the restoration scaffold. No fresh registry, account or production query was made for R6.
- Independently rehashed image archive: `364eb2deb3256c6bf87c3a8551f339aeb91d07f0e3c87fbac0bb5a46c38038c9`; runtime archive: `3e37d0447be86594715c64b693b015645c5200d04c7dbafe45aa9a8b2aaac833`; exact Worker module: `760a78f07c1211cc59e2fc8dac5d0d82512a6e39c0ec6456ab404c0effcf42e0`. Frozen build ID: `K5XRTD25e7gQsVcI5H2-0`. Recovery metadata, server/static manifests and all 52 checklist artifact pins are retained privately; 58 checklist/recovery hash checks matched.
- The approved design and four plans are already preserved byte-for-byte in `evidence/approved-documents`. Their exact shared source paths, sizes and SHA-256 values are recorded in `evidence/p0-r6-parity/approved-documents-verification.json`; all five matched on 21 October. They are authority documents outside the pinned 855 application inputs.
- Read-only ALS reference: `reference/ALS`, origin commit `c224477d291e8b78c687bcde281a47e9679b3ce5`; all 55 snapshot hashes and two saved result-log hashes match. Its existing 263/263 synthetic result was retained without rerunning it.

## Provenance and checklist reconciliation

Eight original modules were recovered textually from historical local `sourcesContent`, with surviving types/tests assembled in R0. Later reviewed core/UI/brand changes are explicit. No useful published source maps recover all original helper filenames, types or file boundaries. Reconstructed names are organizational choices; byte-equal historical module bodies do not prove whole-file equivalence.

The original private `p0-restoration-checklist.md` is preserved unchanged. `evidence/p0-r6-parity/checklist-reconciliation.md` gives a disposition for each of its 22 checkboxes. `parity-audit-final.json` maps every one of the 92 historical source correspondences and all 35 R1 variant decisions to current source hashes. Thirteen sources have at least one exact historical compiled-module match; the other 79 are not classified as behavior changes merely because hashes differ. R1 retained 28 modern variants, restored three originals and reconstructed four bounded deltas; R5 subsequently applied reviewed presentation changes to 11 of those variants, and R3a extended the shared protocol.

| Checklist responsibility | Restored destination and reviewed evidence |
| --- | --- |
| Three original added routes | Assistant page, admin copilot and commercial WhatsApp conversations; R0 originals, R1 integration, R3c/R5 presentation. The assistant is copilot → platform → commercial conversations. |
| Four missing HTTP routes | `/api/admin/platform-whatsapp/status` GET/PATCH; `/conversations` GET/PATCH; `/retry-diagnostic` GET/POST/DELETE; `/api/whatsapp/ycloud/platform/webhook` POST. R3b reviewed exact factories and source integration tests; final build lists each path. No root platform route was invented. |
| Records/configuration/crypto/reader | R2 `shared/platform-whatsapp-records.ts`, `platform-whatsapp-config.ts`, `platform-whatsapp-crypto.ts`, `read-bounded-body.ts`, `ycloud-webhook.ts`; 134 cases and 1,636 bounded comparisons. Shared record filename and readable guards are retained Worker names; other helper/type names are reconstructed. Module51934 is crypto/digest; 83307/31267 are the body/normal reader. |
| Domain and private presentation | R3a `platform-whatsapp-store.ts`, `platform-whatsapp-ingress.ts`, `platform-whatsapp-conversations.ts`, `src/types/platform-whatsapp.ts`; 96 selected cases, real local D1 concurrency/CAS/rollback and 253 comparisons. |
| Existing retry observer | R3b `ycloud-retry-diagnostic.ts`; reviewed durable-close fix, 160 covering cases and 693 comparisons after that fix. Existing protected summary returns full validated Attempt[] up to16; it is not a count. No tuples are reproduced here. |
| Private client | R3c `admin-platform-whatsapp.tsx` and volatile content cache; 94 selected cases, 60 new. Source tests exercise actual API/hook/poller through synthetic boundaries. They are distinct from browser evidence below. |
| Worker bridge/retention/protocol | R3a adds only the two platform parents and numeric `updatedAt`. R4 shares R2 guards, forwards fourteen original strings, adds a manual optional declaration augmentation, preserves generated declarations, restores four cleanup phases and cleanup-before-legacy-wake scheduling. Existing Database/D1/private identity/CAS/journal and modern public/start/Docker configuration are retained. |
| Brand/contact/legal/assets | R5 maps31 destinations and94 literals plus wordmark leaves; separate public support and business-contact helpers, current legal fingerprints, metadata and whole manifest. General legal version2026-10-18.1; subject version2026-10-16.subject.1. No historical acceptance migration. Unproved inactive prompt substitutions were not made. All15 public assets are preserved. |

Current primary hashes are recorded in `parity-audit-final.json`: foundation83b2c448…, ingress95841b53…, HTTP896d7cc7…, UI1754e38d…, Worker e049665d…, brand55af2630…. The original brand primary4efae9c… is historical evidence. Corrected §8.1 proves the complete PNG already exists in a591/6aedaf/455575f: 1,170,753 bytes, SHA-256 `56543737aa55174c19802cebbdda9a775c2a3bcc2a0b343fd5105920b9c20a87`. It was never reencoded or newly added by restoration.

## Cross-task boundaries

| Interface | Evidence and preserved distinction |
| --- | --- |
| Administrator access | Existing `verifyIdToken(token,true)` and exact configured UID precede body/domain/DB access in every admin method; controls receive only the verified UID. R3b routes/auth/integration tests, included in the full suite. |
| HTTP shapes and observer precedence | Status is top-level at `/status`; list/control wrappers match shared types. Diagnostic configuration is checked first and cannot fall back on error. Its isolated stale-signature authentication never replaces normal reception. |
| Ordinary reception | Raw-body HMAC uses exact timestamp digits and bytes with inclusive ±300 seconds; strict two-field reader scope is constructed from three-field config. Scope/filter/signature precede storage. Status/null returns do not initialize ingress persistence or prove receipt. |
| Domain and retention | Canonical/alias/conflict identities, actor/request idempotence, CAS atomicity and separate event/preview AAD remain intact. Body expiry is min(event,receipt)+24h; minimal metadata lasts30d. Ordinary messages do not increment domain control revisions. Local pause/disconnect has no provider unlink effect. |
| Unicode and view privacy | Zod string maxima count code points; manual view limit remains4096 UTF-16 units. A valid long astral message may therefore have its contact/text hidden in the private list. This published discrepancy is preserved, not silently repaired. |
| Client identity and lifecycle | Expected UID before/after token retrieval, generation/abort, monotonic TTL, retained earliest deadline, epoch clearing and irreversible access-loss latch prevent stale publication. GET/PATCH may overlap; two reads are not one database snapshot. View clearing does not prove remote deletion. |
| Worker execution | One shared structural guard definition, fourteen optional string keys, four bounded cleanup phases, CAS reread versus same-command journal retry, exact retention/maintenance flags and cleanup-before-wake ordering. Platform retention alone does not wake or renew the Container. Invalid rows/backlog preclude a promise of exact physical deletion at24h. |
| Legal/contact separation | Public support imports are limited to marketing/help; business links use each business's phone; legal contact, administrator and verified provider identity remain separate. Published legal hashes/fingerprints were independently reconstructed in R5. |

## Integrated validation and retained history

Node24.22.0 and cached pnpm11.23.0. Private runners whitelist OS/path variables, strip inherited credential/channel/runtime variables, refuse real source environment files, disable telemetry and use sibling `test-temp`. Vitest uses `envDir:false`, four workers and external caches. Raw argv/timestamps/exits/stdout/stderr/results are under `evidence/p0-r6-parity`; unaffected green gates were reused as directed.

| Gate | Result and exact evidence label |
| --- | --- |
| Application TypeScript | exit0; `typecheck.*`, on cc4cd5a. The subsequent source commit changes only three test strings. No redundant rerun. |
| Booking suites after label correction | 34/34, exit0; `booking-focused.*`. |
| Installed local Wrangler migration case | 1 selected pass/20 filtered skips, exit0; `migration-correct-temp.*`. |
| Final full application suite | 2,110 passed/0 failed/28 skipped;174 passed/4 skipped files, exit0; `full-vitest-resumed.*`, 21 October19:13:06–19:14:06 UTC. |
| Worker package-check equivalents | 94/94, Worker TypeScript0, actual Wrangler `deploy --dry-run --containers-rollout=none`0; `worker-tests.*`, `worker-typecheck.*`, `worker-dry-run.*`. No deployment. |
| Frozen offline physical install | exit0;319 reused/0 downloaded, ignore-scripts; `physical-offline-install.*`. |
| Actual default Next build | exit0; unchanged Next16.4/Turbopack configuration in physical archived source; `physical-build.*`, 19:15:06–19:15:41 UTC. Build ID `FHUdkJB61o8cKlyp4HdrD`;4,135 output files inventoried. No application was started. |
| Source/public manifest | verifier exit0 against frozen public directory;855 tracked inputs,9 exact binary assets and6 LF-equal text assets. Stale pre-fix source pin rejected as expected. |
| Bounded real-component browser QA | Controller Chrome fixture: desktop and320px without overflow; keyboard focus; UID/logout discard abort-ignoring old GETs; real6s expiry;409 blocks until successful refresh;403 clears private view. Private screenshots/DOM under `evidence/p0-r6-ui-browser`; no browser error/warn logs. Native visibility/blur remains unverified. |

The original full run remains RED:2,104 passed/6 failed/28 skipped. Five failures were stale restored-brand selectors; only three exact positive/negative literals were corrected in8d0b770. The migration failure reproduced with local Wrangler status1/internal-error JSON and empty stderr under the mistakenly deep TEMP; the prescribed sibling TEMP passed. A Workerd path-length mechanism or threshold was not proved. `final-vitest-interrupted.json` records the user stop; it is neither a finished test count nor a hidden retry.

The original default build failed because its existing dependency junction leaves Turbopack's filesystem root. The Worker pnpm script automatically attempted dependency verification/install and refused that junction before running checks; no reinstall completed. Both attempts/logs remain intact. The controller authorized direct Node equivalents for all three Worker stages and one new physical build workspace, preserving existing junctions/config/packages/lock.

`build-source` was initially absent and created only by Git archive of8d0b770. Archive SHA-256 `1772ee3b58d88dc34f73dbbf76a0af6cc9d4125cbd12abcdeb483edee0fb605c`. All855 inputs were verified:178 raw-equal,677 UTF-8 CRLF/LF-only differences, zero other changes; all binaries exact. Package/lock/workspace/Next configuration bytes match original working source exactly. The first overstrict raw-text comparison stopped at `.dockerignore`; its EOL distinction was then verified across the entire archive without changing attributes. Empty private user/global npmrc, unchanged frozen lock and cached private store were used with `--offline --frozen-lockfile --ignore-scripts`; no online fallback or lifecycle execution. Dependencies resolve inside the physical workspace. The build generated only `next-env.d.ts`'s two `.next/dev/types` imports as `.next/types`; original source is unchanged and that generated build-copy delta is accounted separately. Logical regular-file lengths total1,030,142,670 bytes; pnpm hardlinks reuse cached bytes, so this is not unique added disk allocation.

## Manifest semantics

[baseline.manifest.json](2026-10-18-whatsapp-adaptation-baseline.manifest.json) pins every Git blob at8d0b770; source index SHA-256 `831547bce3dd7861bd0057827d49cfd75e15387507d2580f6a15a62b67635d14`. Manifest SHA-256 `858d4d523998ca65ad3abb38f09bc9d87afc83f5622a8d10044e03263e02dce0`. Nine public binaries match runtime bytes; six text assets differ in raw Git/runtime hashes and match only after CRLF→LF. Working source equality permits that same text-only distinction. Private/generated/untracked files are excluded from the source inventory.

The following documentation/verification-only commit adds exactly this note, its manifest and `scripts/verify-whatsapp-baseline.mjs`. Its SHA is found in Git history rather than embedded in its own manifest. The pinned source commit excludes all three paths, avoiding self-reference. From the baseline checkout:

```text
node scripts/verify-whatsapp-baseline.mjs
node scripts/verify-whatsapp-baseline.mjs --reference-public <private-package>/recovery-image/public
```

The first command checks pinned Git/current source and recorded public-reference relationships; the second additionally rehashes actual supplied frozen public files. Neither executes runtime code or checks production. The verifier rejects a later HEAD with non-followup changes and rejects changed current source bytes. After A1 begins, use a separate checkout of this baseline documentation commit to reverify historical baseline; failure on future source changes is intentional. Do not rewrite the historical manifest to make new code look like the old baseline.

## Limits and capability matrix

The final full suite retains614 renderer deprecation lines; Worker tests retain four `MODULE_TYPELESS_PACKAGE_JSON` warnings. Build stdout contains the first-build no-cache notice; install/build stderr is empty. No warnings were suppressed. The28 opt-in skipped cases are1 DeepSeek live,15 Firestore integration,11 Firestore rules and1 local journey. Individual names are retained privately in `parity-audit-final.json` and the full JSON result.

R3a's absent preimplementation semantic RED remains an explicitly accepted historical process exception; its later62-failure sensitivity check is not relabeled TDD. R3c's two page RED failures were renderer/Link setup, with50 meaningful cache/component RED cases separately preserved. R5's original PNG provenance error and reviewer public-contact masking miss remain disclosed; no record was rewritten to erase them. Existing renderer/module-type maintenance is deferred.

| Capability/gate | Current evidence and limit |
| --- | --- |
| Restored existing reception/admin/retention | Local synthetic source gates above; no restored candidate activation or live equivalence claim. |
| Bounded desktop/320px browser fixture | Actual current panel/cache/API/poller, React and CSS with synthetic identity/in-memory transport. Desktop1746×997 and320×780: no workspace overflow; enabled buttons44px; keyboard traversal and blue3px focus-visible outline observed. UID switch/logout rejected held old responses;6s plaintext expired after6500ms while metadata remained;409 retained state/block until complete refresh;403 removed private state. This is component QA, with no real auth, SSR/backend, full assistant page or authenticated P2 claim. |
| P1 existing closed trial facts | Saved controller evidence reports retry compatibility, real inbound, human echo, manual pause and local disconnect checks. These historical live facts were not rerun or replaced by synthetic outcomes. |
| P1 ordinary provider duplicate | **Unverified**: no verified provider mechanism for redelivery of the same event/raw ID with a fresh signature. Synthetic idempotence and observer compatibility do not close this fact. |
| New menus/audio/private links/AI/send/web support | Later A/B/C/P2 work; no automation activation. Platform source AI/send outputs remain false. Personal/Vault stay retired without purging older browser data. |
| Wider CI and operations | Firebase rules/emulators/journey, live provider, pages gateway, landing/pages builds, dependency audit, authenticated P2 and deployment checks were not run. No full-CI claim. |
| P0 acceptance | Independent controller whole-baseline review remains required before P0 closure/A1. No push, merge, deployment or production/configuration mutation is authorized by this note. |

Full task reports/reviews and accepted rulings remain in the private ignored `.superpowers/sdd/2026-10-18-sarinbot-whatsapp-adaptation` workspace. Raw recovery/reference artifacts, original failed/interrupted attempts, build inventory, all per-path mappings and proof limits remain in the private package rather than Git.

Browser authority is the controller's `task-p0-r6-browser-report.md` and fixture owner's `task-p0-r6-ui-fixture-report.md`, with18 input/six static artifact identities. Native hidden/blur/focus remains **unverified**: second-tab and bring-to-front probes did not produce the required native events. Both inconclusive observations are preserved; no privacy failure or successful native lifecycle check is inferred. Existing renderer event tests are supporting semantic evidence. Two unsupported DOM-facade probes and the first320px loading screenshot remain disclosed; the completed-row screenshot is separate. The browser-only fixture build retains ordinary `use client` bundler warnings. All fixture tabs closed and viewport reset; port43187/serverPID22800 were verified absent at19:24:47 UTC. No application server or real provider/backend was started.
