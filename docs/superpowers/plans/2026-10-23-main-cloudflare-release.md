# Main and Cloudflare release consolidation

The owner requested one GitHub branch (`main`) and a complete Cloudflare deployment on each push. This changes release orchestration; commercial data remains in D1, files remain in private R2, and Firebase Authentication keeps the same user identities.

## Design

Use the existing `Verify Sarin` GitHub Actions workflow as the sole coordinator. A push to `main` runs the three existing verification jobs before building and publishing the commit's Container image, the Worker and finally the Pages gateway. Pull requests only verify. Production releases serialize and are not automatically cancelled midway. A queued obsolete commit must not overwrite newer production code.

Preserve runtime variables and secrets, the existing D1/R2 and Durable Object bindings, and one Container instance. Pin the image by registry digest and reconcile the deployed Worker/Container before publishing Pages from the same commit. Do not perform database migrations or change feature flags as a side effect of a normal push. Disable the separate Pages Git builds when the replacement workflow is ready.

## Implementation and validation

1. Record live backend, branch and hosting configuration. Back up all Git history outside the repository before consolidation.
2. Add the gated deployment job and a tested release helper. Keep the deployment token in GitHub Actions secrets and public Firebase build inputs in repository variables; no local OAuth or runtime credentials go into CI.
3. Verify preflight rejection, stale-commit handling, deployment ordering, runtime preservation and rollout reconciliation using synthetic provider responses. Run the Cloudflare checks and the existing CI suites.
4. Retain historical commits when consolidating branches. Preserve the superseded catalog fallback in ancestry without applying its old removal of catalog features. Merge the two local historical documentation commits without changing the dirty original workspace.
5. Configure the scoped deployment credential and disable the independent Git build once ready. Push the reviewed result to `main`, verify the full release and then delete remote feature branches only after verifying their heads are ancestors of `main`.
6. Record the final commit, CI run, Cloudflare versions and remote branch inventory. Keep the original uncommitted workspace and Firestore migration backup intact.

## Initial evidence

At 2026-10-24 01:51 UTC, Worker version `7f129029-3c3c-4008-89b9-1882fdf9b850` served 100% of traffic with `SARIN_DATA_BACKEND=d1`. The bound resources were D1 `sarin-bot-data`, private R2 `sarin-bot-files`, and the existing Sarin Durable Objects. Container application `sarin-bot-app-sarinapp` had one maximum instance. Firestore is retained migration/recovery history, not the active commercial database. Local emulator tests still intentionally exercise the retained Firestore backend.

The remote had 17 branches. Fourteen old feature heads were already in `main`; Fresha P2 and the historical catalog fallback were the exceptions. P2 commit `e8f6e0348797ec4d52890f499ace92939909b3e0` passed all three CI jobs in run `40051142036`. The complete Git bundle was verified outside Git. GitHub initially had no Actions secrets or variables; Pages still built independently from Git. These are initial observations, not a claim that the new release has completed.
