# In-app appointment reminders implementation plan

Goal: deliver the approved single 24-hour reminder in Mis citas, validate it with synthetic data, and publish the verified increment under the owner's standing authorization.

Architecture: derive reminders from canonical appointments; persist separate opt-in preferences and explicit seen receipts through the existing document database. Preserve booking and rescheduling transactions. No scheduler or external notifications.

Tech stack: Next.js / strict TypeScript / Firebase Auth / document database on D1, Firestore emulators for isolated browser QA; Vitest and Cloudflare Node tests.

Spec: [approved design](../specs/2026-10-17-in-app-reminders-design.md).

## Global constraints

- Worktree `F:/Proyectos/SarinBot-worktrees/service-catalog`; branch `codex/in-app-reminders-20261017`; base `e5a81f6e7340fedfeac2ca9c1474f8c08f121178`. Do not change the original checkout or immutable v18 release package.
- Exactly one reminder, offset 1440 minutes, eligibility `now < startAt <= now + 86400000`. Account and business consent anchors must still match the verified current receipts. Off by default; explicit re-enable after consent revisions change.
- UID comes only from authentication. Strict bodies and query validation, no-store responses. No beneficiary, service, contact or intake in reminder projections.
- Separate collections `businesses/{id}/reminderPreferences` and `businesses/{id}/reminderReceipts`, deterministic hashed document IDs. No writes to Appointment and no GET writes.
- Physical receipt per owner/business/appointment/offset; logical occurrence adds source revision and start. Exact current retry preserves seenAt. Stale occurrence conflicts. Preference expectedRevision prevents stale reactivation.
- Foreground-only polling; explicit seen; errors never mean empty. Scope changes and stale handlers cannot reveal or mutate the previous account's data.
- One production replica, existing provider/bindings/secrets preserved. Only synthetic QA writes. User authorized implementing, testing and publishing this increment.

## Shared interface

`src/types/appointment-reminders.ts` exports:

```ts
type ReminderOccurrence = { appointmentId: string; sourceRevision: number; sourceStartAt: number; offsetMinutes: 1440 };
type AppointmentReminder = ReminderOccurrence & { availableAt: number; seenAt: number | null };
type ReminderPreference = { enabled: boolean; revision: number; status: 'disabled' | 'active' | 'suspended'; offsetMinutes: 1440 };
type AppointmentReminders = { businessId: string; ownerUid: string; serverNow: number; preference: ReminderPreference; reminders: AppointmentReminder[] };
```

- GET `/api/businesses/[id]/reminders`: no query; returns AppointmentReminders.
- PATCH `/api/businesses/[id]/reminders/preference`: `{enabled:boolean,expectedRevision:number}`; returns AppointmentReminders, reconcile using GET after any uncertain result rather than retrying the old mutation.
- POST `/api/businesses/[id]/reminders/seen`: ReminderOccurrence; returns `{reminder:AppointmentReminder}`. Retry only the identical occurrence; stale occurrence returns409, inactive permissions428, absent/foreign appointment404.
- New `ClientAppointmentReminders` component receives businessId, userId, now, actionsLocked, onViewAppointment(occurrence). It owns its separate hook. Parent validates current appointment/occurrence and locks before focusing a visible card.

## Review focus

1. Cross-account/tenant disclosure: server auth tests, projection tests, retained UI handlers and scope switches.
2. Race/read ambiguity: real D1 two-connection tests for consent and preference revisions, lost seen response and reschedule/cancel conflicts.
3. Mutation isolation: unchanged Appointment fingerprint and pending reschedule proposal after marking seen; no writes during GET.
4. UI freshness: inclusive 24h/exclusive start, errors, optimistic hide, reconciliation and foreground polling.
5. Release reliability: exact GET session maintenance exception with boundary tests; singleton queue gates, immutable image/source and rollback compatibility.

## Task 1 — maintenance session routing

Files: `cloudflare/src/router.ts`, corresponding `cloudflare/tests/*` maintenance tests.

- [x] Add a failing routing test for exact bearer-format GET `/api/session` in maintenance and rejects for absent/malformed auth, non-GET, queries/hash and ordinary business traffic.
- [x] Allow only the exact request through to Next; retain Next's actual authentication.
- [x] Run focused tests then independent diff review. Do not deploy yet.

## Task 2 — reminder contracts, persistence and API

Files: new shared type, `src/lib/server/appointment-reminders.ts`, focused consent anchor export in `src/lib/server/consent.ts`, three reminder routes, `shared/data-protocol.ts`, tests. Existing Firestore appointment index covers uid/status/type/startAt; add receipt owner/appointment index for the private maintenance scope. D1 adds `cloudflare/migrations/0002_appointment_reminder_window.sql`; fresh local data runtime applies migrations in order.

- [x] Write and run failing business/API tests using isolated database fixtures.
- [x] Implement verified consent anchors, preference CAS, narrow future-window query, deterministic receipts and transaction revalidation. All reads before writes. Explicit overflow handling.
- [x] Add real D1 two-connection scenarios, private Firestore path denial, and unchanged appointment fingerprint regression.
- [x] Prove the additive D1 index bounds future-window reads despite1001 historical appointments and preserves existing documents. Keep0001 unchanged; v18 rollback retains the harmless index.
- [x] Run focused checks; independent spec/security review.

## Task 3 — reminder UI and integration

Files: new component and hook, `src/components/client-appointments.tsx`, focused tests; business page only if needed for a link.

- [x] Write failing UI/hook tests for off/enable/suspend/disable, seen, pending/seen sections, errors/retry, scope/stale responses, lost mutation response and same-event latch.
- [x] Build using existing visual tokens and foreground polling, no permissions/background APIs. Toggle and all action state accessible by keyboard.
- [x] Parent focuses a canonical matching appointment card in Próximas and respects existing action mutex; cancellation and rescheduling invalidate displayed occurrence.
- [x] Run focused tests and independent UI review, including exact-start expiry and lost-preference error follow-ups.

## Task 4 — private data lifecycle and integrated QA

Files: synthetic fixture scripts, privacy procedure under docs, tracked QA report/screenshots.

- [x] Document export/deletion of preferences and receipts for appointment/account/business; exercise the exact procedure on owned synthetic data, verify absence and neighboring records untouched.
- [x] Start isolated demo Auth/Firestore and app; verify initial/enable/reload/seen/focus, read error, synthetic reschedule14:00→15:00 and cancellation. Preserve production session and consents.
- [x] Complete browser320/390/1280 coverage, logout privacy check, final lost-preference response recheck and correctly framed screenshots; automated tests cover UID/business switches.
- [x] Full app tests, typecheck, Cloudflare check and dependency audit; record actual results and limitations.
- [x] Rebuild latest reviewed UI for local acceptance; clean only fixture-owned data and verify absence/preservation (17 owned documents, shared Auth/account consent preserved).
- [x] Stop only owned local processes and verify ports are free; immutable production-image build also completed in Task5.

## Task 5 — publish and close

- [x] Independent whole-change review and focused fixes; code review PASS includes the later preference-error follow-up.
- [x] Finish remaining acceptance gates and commit/push exact reviewed runtime `ed28549402b2c93e88324f33f130ef6f56d6988d`.
- [x] Create a new release package, hash immutable v18 baseline, freeze739 source files, build immutable candidate and audit/smoke it. Prepare compatible rollback.
- [x] Before the additive index, drain writers, export and locally restore/verify a private D1/R2 backup, apply only0002 and verify unchanged54 documents/4commits/revision37 plus1R2 object. No document migration or deletion.
- [x] Maintenance/drain using real authenticated queue; roll single container, verify effective image, old allocation0, candidate queue0, reopen exact config. Authenticated maintenance GET/session200 confirmed administrative access.
- [x] Verify production HTTP/browser and authenticated queue; document evidence and observational limits. Production shows optional disabled reminders; complete action flow remains synthetic local only.
- [x] Commit/push final documentation and sync the completed package without touching v18; exact documentation revision retained in the private review record.

## Progress

- Design approved: one24h reminder, explicit persistent seen, in-app only. Standing publication authorization applies. Implementation, independent reviews, local QA/cleanup, immutable package, additive index and production gates complete; final documentation committed/pushed and the completed package synchronized.
- Maintenance routing: independent root reviewPASS; router27/27 andCloudflare76/76. Real authenticated GET/session returned200/isSuperadmin true duringmaintenance at2026-10-18T01:23:48.603Z and session was reverified after reopening.
- Private lifecycle:10testsPASS, including actual localD1 two-connection conflict and appointment-only/combined owner-appointment scopes. Review found and fixed the missing D1 appointmentId query field; no production deletion.
- Implementation decision from measured evidence: add a compatible D1 query index. Initial expectation of noSQL migration was revised after1001 historical appointments increased oneGET from17 to1018rows. This is a non-destructive implementation refinement within the approved feature, validated and backed up before production.
- Final measured indexed fixture:16rows read/0written/16statements both baseline and1001history. Production applied only exact0002 after backup/drain; independent audit confirms54docs/4commits/revision37 unchanged and1R2 object locally restored/verified.
- Automated evidence:1482app testsPASS/27skip across149files, UI48PASS, backend/regressions53PASS, emulator rules25PASS, Cloudflare76PASS plusdry-run, typecheckPASS and no known dependency vulnerabilities. Counts overlap; they are not additive.
- [Final QA/publication report](../../qa/2026-10-17-in-app-reminders.md):20local browser checks true, response-loss recheck passed with onePATCH/no replay, synthetic reschedule14:00→15:00/cancellation, cleanup17owned docs including2reminder docs. Local processes stopped and sixports free. Actual production screenshot shows disabled optional24h reminders; no browser writes to production preference/seen/appointments/consents.
- Published Containers v19: image515440cfc7cb1ea7d2bb2e282cbe90cd6c5eb37dafc00859915b06598adc6afe, Worker50207852-3327-48d0-adb0-4417c454a3c3, allocationd0362b28-5703-4e46-85e8-c0974f60649b. Effective singleton running/DOconnected, old0, settings/13secret names/Pages unchanged, maintenancefalse.
- Four mandatory authenticated empty-queue gates passed in standard order, plus two rollout warmups. Source/ZIP exact739files, image build/smoke and independent package auditsPASS. Alpineworkerd postinstall validation warning remains documented; Next runtime build/smoke passed, not Alpineworkerd execution.
