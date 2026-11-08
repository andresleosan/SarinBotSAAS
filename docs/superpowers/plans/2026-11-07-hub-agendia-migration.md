# Sarin Bot Hub and AgendIA migration

**Goal:** Deliver two independent local projects, repositories and web deployments: the agency Hub in Sarin Bot and the commercial appointment UI in AgendIA, connected through the existing authenticated APIs.

**Architecture:** Sarin retains the only inference/WhatsApp runtime, D1/R2 and Firebase Admin identity. AgendIA has its own Next standalone web container and private Worker. Its Pages gateway sends an explicit commercial API allowlist to Sarin through a Cloudflare service binding, and pages/assets to its own UI Worker. This follows the owner's clarification that the projects must be separate, not two branded views of one Next runtime.

**Stack:** Existing Node 24.22.1, pnpm 11.23.0, Next 16.4.3, React, Firebase Auth, Cloudflare Pages/Workers/Containers. Preserve the dependency lock and existing production settings.

**Requirements:** Owner's three-phase request of 2026-11-07 and follow-up: separate projects, folders and repositories, with Sarin Bot providing the chatbot services for AgendIA.

## Execution

1. Preserve all working changes and local/private material, verify the backup by hash, publish outstanding useful main tests, move main into the root, archive residual directories and reconcile Fresha control paths without changing progress. Evidence: `docs/qa/2026-11-07-worktree-consolidation.md`.
2. Following the owner's later clarification, make Sarin's root and static landing promote chatbot services for websites and businesses, with a secondary `/admin` entry. Its independent chatbot pricing needs owner-supplied amounts/quotas; the owner expressly chose separate plans rather than AgendIA's existing appointment tariffs. Update agency labels and Hub authentication/metadata inside `/admin`. Preserve protected WhatsApp/AI components, `src/lib/sarin`, admin/Sarin APIs, all `cloudflare` configuration/code, old booking links and WIF discovery endpoints.
3. In the shared backend, admit only the exact new AgendIA origin for consent; extend approved booking origins; allow the authenticated QR endpoint's explicit `application=agendia` selector to return that fixed domain. Never infer the booking destination from arbitrary Host or forwarded headers. Tests cover foreign/preview origins, malformed selectors and ownership.
4. In the independent AgendIA clone, apply the specified name, white/sky-teal wordmark, slogan and Sarin/ALS credits. Keep the light Agenda clara workspaces and assistant identity. Remove administration links and deny administration at both public gateway and UI server boundaries.
5. Create AgendIA-only hosting configuration and deployment scripts. No D1/R2/Admin/provider/WhatsApp credentials, cron or inference startup in its UI runtime. Keep browser Origin and bearer tokens through the approved private service boundary; no body logging or private caching. Unknown routes/methods and encoded bypasses fail closed.
6. Run focused domain/boundary/UI tests, typecheck/build, protected-path comparisons and Playwright MCP QA. Publish the separate public AgendIA repository and deployment only after the candidate is validated. Add the exact domain to existing Firebase Auth without changing other domains. Verify live Hub, AgendIA, assets, unauthenticated API behavior, forbidden admin paths and WIF discovery.

## Review focus

- No second background processor, inference queue or shared-state copy in AgendIA.
- No inherited deployment script/workflow can publish AgendIA over Sarin resources.
- Encoded paths, foreign origins and arbitrary forwarded headers cannot expose admin or internal APIs.
- Existing users, consent fingerprints, business ownership, public booking links and callback/webhook endpoints remain valid.
- Separate repositories contain no environment secrets or private QA exports; canonical Fresha progress remains local to the control root.

The user explicitly requested GitHub creation and Cloudflare publication. This request does not authorize real messages, purchases, paid inferences or activation of unfinished Fresha capabilities.
