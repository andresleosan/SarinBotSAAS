# VPS Firebase X.509 Implementation Plan

> **For agentic workers:** Use native execution with independent review of certificate rotation and SDK configuration. Continue the owner's authorized Firebase/VPS integration; production application publication remains separate.

**Goal:** Validate renewable Firebase Admin credentials on the existing VPS without copying Windows developer credentials or enabling billing.

**Architecture:** Use the dedicated `sarin-vps` federation pool and a private CA restricted to the VPS root user. The application receives only a short-lived client certificate and ADC configuration through a read-only directory mount. Preserve the existing Firebase service account and application authorization.

**Tech Stack:** OpenSSL, systemd, Google Workload Identity Federation X.509, Firebase Admin 14.5, Node 24, Docker.

**Spec:** [remote-ollama-connection.md](../../remote-ollama-connection.md), [STACK.md](../../../STACK.md).

## Global Constraints

- Keep billing disabled; do not change service-account key creation policy.
- Scope impersonation to `sarin-runtime` and the exact certificate subject.
- Never print tokens, private keys, request bodies, or database documents.
- Keep the CA private key outside the application mount; isolate all VPS files under `/opt/sarin-bot`.
- Do not modify shared Vault, Caddy, other applications, or domain delegation.
- Do not restart the Mac; its restart test was deferred by the owner.

## Review Focus

- Reject certificates with a different subject or URI SAN.
- Publish certificate/key pairs atomically to avoid mixed generations.
- Fail closed on issuance or validation error; retain the last valid generation.
- Confirm the actual container's SDK accepts the ADC configuration.
- Verify Firebase reads without creating business data or logging document contents.

## Tasks

- [x] Create and inspect a disabled federation-only pool; confirm billing remains disabled.
- [x] Review and syntax-test isolated certificate rotation; generate dedicated CA and initial leaf without exposing keys. Ten isolated WSL checks passed.
- [x] Register the public CA, restrict provider attributes, and bind only the exact subject to the existing service account.
- [x] Validate token exchange, Auth, Firestore and rejection of an incorrect URI certificate with allowlisted result metadata; no business writes.
- [x] Configure automatic renewal after validation; verify the actual service succeeds and its enabled timer waits for the next run.
- [x] Validate certificate changes, missing-source rejection and rollback with the same SDK client and Node process, using isolated certificates; preserve the live pointer and remove test material.
- [x] Start private loopback-only staging; verify Google sign-in, actual container Firebase reads, and automatic Docker recovery after the Next process exits.
- [ ] Validate recovery after a complete VPS restart and operator failure notification before claiming unattended reliability; do not restart the shared VPS as part of this preparation.

The actual application image passed `TOKEN_EXCHANGE_OK`, `AUTH_READ_OK` and `FIRESTORE_READ_OK`. Billing was verified disabled afterward. Private staging is running, Google sign-in succeeded, and the browser session survived application recovery. At the close of October 14, Access, tunnel routes and DNS activation were pending; see [pre-DNS QA](../../qa/2026-10-14-vps-pre-dns.md). On October 15, DNS and Access were configured, while recovery of the Mac connector remained pending; see [DNS cutover QA](../../qa/2026-10-15-dns-cutover.md). The temporary DeepSeek provider subsequently passed the authenticated browser chat check; see [provider QA](../../qa/2026-10-15-deepseek-option-b.md).

## Rollback

Disable the dedicated pool to stop federation and remove its exact service-account binding if abandoning this route. Stop only the dedicated renewal timer. Preserve private material until any application using it has been stopped; never delete shared directories or alter unrelated policies.
