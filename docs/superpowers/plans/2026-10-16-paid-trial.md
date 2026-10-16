# Paid trial implementation plan

> For agentic workers: use subagent-driven-development with independent ownership below. Track completion here and in the progress ledger.

Goal: replace free trial access with an approved COP 5,000 purchase for configuration and ten appointments, without time expiry.

Architecture: preserve the existing Firestore transaction and receipt review boundaries. Add paid introductory entitlement to the business subscription, atomically consume appointments, and enforce permission before paid model calls. Preserve existing paid subscriptions and local Vault data.

Tech stack: strict TypeScript, Next.js App Router, Firebase Admin/Firestore, Vitest, Node 24 and pnpm 11.23.0.

Spec: ../specs/2026-10-16-paid-trial-design.md

## Global constraints

- Exact COP 5000, ten appointments, no time expiry; no free onboarding inference or upload grace bypass.
- Keep pnpm-lock.yaml and provider settings untouched; synthetic demo projects only.
- All counter/payment mutations server-only; public projections exclude receipt IDs.
- Existing confirmed reservations remain readable/cancellable and retries remain idempotent after exhaustion.

## Review focus

- Concurrent bookings on different resources with one remaining unit.
- A saved tenth appointment followed by model/network failure and retry.
- Two approval attempts or new receipts cannot repurchase/reset the introductory offer.
- Legacy free trial timestamps and receipt upload grace cannot authorize unpaid AI.
- First payment before a configured business has no public slug and no permission cycle.

## Tasks

- [x] Billing/data owner: write failing tests, implement shared contract, types, draft creation, payment kinds, approvals and period state, then run targeted tests. Own types/firestore, paid-trial, sarin/subscription, server/businesses, billing, billing-policy, schemas, response-periods and their focused tests.
- [x] Scheduling/AI owner: write failing behavior tests, consume appointment units atomically, preserve replay after exhaustion, remove free onboarding metering, enforce mode/owner AI access, update prompts/tools and relevant server tests. Own server/bookings, chat, response-quota, sarin/prompts/tools and tests. The existing admin-only Vault gate remains unchanged.
- [x] UI owner: update onboarding payment-first flow, billing/admin receipts and counts, dashboard/public client states, marketing/landing copy, quota displays and meaningful UI tests. Own frontend files and tests; consume the shared contract.
- [x] Root: review integration, update emulator/rules/journey tests and compatibility documentation; verify all relevant tests/typecheck/build/landing; independently review security and requirements, fix findings, integrate into original checkout without overwriting unrelated files.

## Progress ledger

Baseline: 534 tests pass, 18 skipped; typecheck passes. pnpm_config_verify_deps_before_run=warn is a temporary process-only override needed for the reused node_modules junction; no dependency or lock changes.

Ruling: cancellation does not refund a successfully created appointment; it has consumed service work. Failed operations and replays never consume.
Ruling: preserve existing 700-response total safety quota independently from the new ten-appointment quota. No daily/date reset or pack purchases for the introductory offer.
Ruling: use current payment review, not a new payment gateway, and retain paid renewal grace only for genuine prior paid subscriptions.

Final verification: 578 tests pass / 20 skipped; 19 real Firestore emulator tests and the local journey's 96 checks pass. TypeScript, audit, production build, landing export/validation and desktop/320 px browser review pass. Independent review closed the public tenth-appointment retry issue with a red/green surface regression. Visual review corrected empty draft labels and distinguished consumed appointments from date expiry. The reviewed changes are integrated into the original checkout; its normal production build passed, preserving shared dependencies and lockfiles. Temporary local QA services and tabs are closed. Evidence: ../../qa/2026-10-16-paid-trial.md. No deployment or real database changes.
