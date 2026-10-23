# Production Readiness Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the measured stale-work D1 fan-out and Next security findings, then establish exact-candidate release evidence.

**Architecture:** Add negative-only early stale-head rejection; retain full fresh authority/CAS before effects and existing private cleanup. Patch Next one exact release and regenerate its existing lock records. Preserve separate local, manual and deployed evidence.

**Tech Stack:** Node 24, pnpm 11.23.0, Next 16.4.1, React 19.3.0, Vitest, Miniflare D1, Firebase demo emulators, Wrangler dry-run.

**Spec:** docs/superpowers/specs/2026-10-23-production-readiness-design.md

## Global Constraints

- Node 24, pnpm 11.23.0; preserve one shared pnpm-lock.yaml, with only the required patch changes.
- Original D1 deadline 30 seconds, fifty continuations, pagination25×4 and all prepared/claimed/expired/stale assertions remain.
- Negative head rejection never authorizes an effect; fresh full identity/consent/connection authority and transactional CAS remain.
- Preserve private cancellation, reservations, uncertainty/idempotency, AuthGate, consent and commercial/API contracts.
- Existing isolated source only; no protected-source or mixed-E code changes. Only alsdevstudio.com for engine hostname.
- Demo/simulated providers only; no real sends/payments/activation. main push deploys production.

## Review Focus

- A current head changes after early inspection: final full authority still rejects the stale effect; Task1 existing/new deferred race tests.
- Private stale/invalid output: safe cancellation still occurs without exposing/retrying it; Task1 private worker regressions.
- Advance scheduling and malformed/cross-scope head: preserve normalization and fail-closed behavior; Task1 shared/Worker tests.
- Fifty stale rows across pages: live work is reached once and old budgets/states stay intact; Task1 unchanged real D1 integration.
- Patch install/hosting split: pinned React/Sharp and lock remain, app standalone plus landing/Pages/Worker build; Tasks2–3 exact checks.

### Task 1: Reject stale-head work before irrelevant D1 reads

**Files:** Modify `shared/platform-whatsapp-work-authorization.ts`, `src/lib/server/platform-whatsapp-work-store.ts`; extend existing `tests/platform-whatsapp-worker.test.ts`, `tests/platform-whatsapp-work-store.test.ts` or `tests/platform-whatsapp-work-authority.test.ts` and `cloudflare/tests/platform-whatsapp-work.test.mjs` only where the owning scenario belongs. Preserve `tests/platform-whatsapp-automation-d1.integration.test.ts` assertions/deadlines.

**Interfaces:** Existing `potentialPlatformWork`, `currentWorkProjection`, `readOutboxDispatchPreparation` and work-store authorization remain the consumer/producer contracts. Internal negative-only helpers are allowed; no REST/data schema changes.

- [ ] Read external readiness-d1-diagnosis.md including measured phases; capture deterministic RED for stale head rejection before unrelated reads/identity, live/full-authorization fence, private cleanup and advance/cross-scope behavior.
- [ ] Implement only the measured redundant-read remedy, with no positive-authority cache or concurrency/budget change.
- [ ] GREEN covering unit/Worker tests and the complete automation D1 file (all cases, original deadlines), types and diff check; preserve actual timings and prior failures. Commit focused fix.
- [ ] Independent scoped spec/quality review and bounded fixes before Task2.

### Task 2: Apply the exact Next security patch

**Files:** `package.json`, shared `pnpm-lock.yaml`; no other manifest changes unless the pinned resolver demonstrates necessity.

**Interfaces:** Existing App Router standalone build and static landing use the same root Next. React/React DOM19.3.0 and Sharp0.35.5 unchanged.

- [ ] Use the fresh audit RED and official vendor package/release evidence. Change exact next pin16.4.0→16.4.1 and regenerate the existing lock with pnpm11.23 in a sanitized environment; no audit fix/major update.
- [ ] Frozen install, verify resolved Next-owned versions16.4.1 and unchanged React/Sharp, fresh audit GREEN, types and P1 focal tests. Review only necessary lock churn and commit.
- [ ] Independent scoped spec/quality review before final heavy validation.

### Task 3: Establish exact final release evidence

**Files:** Create `docs/qa/2026-10-23-production-readiness.md`; update E: handoff only after evidence. Existing external normalized runners own raw logs, not Git.

**Interfaces:** Consume reviewed Tasks1–2 hashes; produce command/exit/count/pin results with separate outstanding observations.

- [ ] Execute unfiltered full app suite once, types/build and fresh audit, then gateway, landing export/check/Pages, rules, local smoke/journey, Worker check. Keep heavy runs sequential and demo off for full/build. Original deadlines/configured assertions remain.
- [ ] Scoped browser recheck after the patch; preserve exact focus/authority behavior. Obtain audible/native observation only through supported real observation, otherwise report pending explicitly.
- [ ] Reconcile current runtime read-only metadata and candidate provenance. Preserve failed/auth-limited results; no deploy/merge/main push as a substitute for validation.
- [ ] Record exact source, commands, environmental differences, real skips/failures, reviews and readiness limits. Commit documentary evidence.
- [ ] One broad review of corrective range from3351698, then the single final fix wave/scoped re-review if needed. Integrate/publish only with required gates resolved and the user's deployment authorization applicable to the concrete result.
