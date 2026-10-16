# Paid introductory access

## User requirements

Replace every automatic seven-day free trial with a one-time COP 5,000 introductory purchase. It enables business configuration and up to ten newly created appointments. The user explicitly chose no time expiry: access lasts until those ten appointments are consumed. Continuing requires a subscription plan. Preserve existing subscription plans and the existing receipt review process.

## Access and data contract

- A new owner has no AI access. A valid first receipt may atomically create a private, incomplete business draft; no slug or public projection is allocated until paid configuration is saved.
- Business.subscription.status adds pending_payment. Keep trialEndsAt only for historical storage compatibility; it never grants free access or postpones a paid subscription.
- An approved introductory receipt sets status trial and paidTrial: { paymentId: string, activatedAt: number, appointmentLimit: 10, appointmentsUsed: number }. The purchase costs exactly 5000 COP server-side, is never renewable, and grants no upload grace. Existing free trial records without paidTrial lose free access; valid paid subscriptions retain their time.
- Only an approved introductory purchase or a valid subscription permits initial configuration or commercial inference. Trial mode allows onboarding and client scheduling, not owner copilot, WhatsApp, or response pack purchases. The existing superadmin-only Vault is an internal tool outside commercial tenant entitlement: preserve its admin authorization and browser-local data. Reading/cancelling existing appointments remain available.
- Successful new appointment creation increments paidTrial.appointmentsUsed atomically in the same transaction, across every resource/date. Maximum ten. Conflicts, failed validation, manual blocks and identical retries consume nothing. Cancellations do not refund a consumed unit. Replaying a saved tenth appointment succeeds even after exhaustion and even if the later model explanation failed.
- Client public projections include only activatedAt, appointmentLimit and appointmentsUsed from paidTrial, never its paymentId. All payment/access/counter writes stay server-only.
- Keep response metering separate: the paid trial inherits the existing total allowance of 700 AI responses, now without date resets. Remove the old free 30-response onboarding path. Its period has an internal maximum timestamp sentinel; UI displays appointment usage rather than a fictional expiry date. A subscription approval supersedes trial immediately and starts from max(now, existing paid subscription end), never old free trial time.
- Only owners with a genuinely paid subscription history may receive the existing one-time renewal grace; pending or exhausted introductory access cannot be unlocked by uploading another receipt.

## Shared implementation interface

Create src/lib/paid-trial.ts exporting PAID_TRIAL_PRICE_COP=5000, PAID_TRIAL_APPOINTMENT_LIMIT=10, PAID_TRIAL_INCLUDED_RESPONSES=700, PAID_TRIAL_PERIOD_END=8640000000000000, canPurchasePaidTrial(subscription), and paidTrialRemaining(subscription). These helpers accept Business['subscription'] or the compatible public subscription shape and fail closed on malformed counters.

Extend src/lib/sarin/subscription.ts with getBusinessAccess(business, now?) returning pending_payment | paid_trial | trial_exhausted | subscription | expired | suspended; retain isSubscriptionAllowed as the operational scheduling/configuration guard. Add isOwnerAiAllowed for subscription-only owner AI. Helpers must also work on public projections without a receipt ID.

Receipt kind adds paid_trial; its server-snapshotted amount is 5000 and appointmentAllowance is 10, with no planId or periodDays. Billing GET already supports business:null. Submit supports a first paid_trial or subscription receipt and creates the private draft inside its transaction only after validation. createBusiness requires paid access, initializes the slug for an incomplete draft, and preserves entitlement/counters on edits. Existing configured slugs stay permanent.

## Scope and delivery

Implement and verify in an isolated worktree, then integrate the reviewed patch into the user's working checkout. No deployment, remote data mutation, engine/provider switch or wallet top-up is part of this request. Existing video materials remain preserved; their seven-day promotional screens must be replaced before export. Document compatibility and rollback; do not apply a production migration.
