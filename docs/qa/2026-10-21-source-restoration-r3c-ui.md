# Platform WhatsApp UI restoration — local evidence

Base: `1a05f190438ee3c5728b9bc8df207862a922b4c3`. This cut restores the private platform section between the administrative copilot and ordinary business conversations. It preserves the page's admin gate and account remount, uses the reviewed status/conversation types, and reuses the existing API client and poller unchanged.

## Authority and behavior

The complete private UI contract was read and its SHA-256 verified: `1754e38d8d8370e2b87e44f3ed2fd016635f53eb66264e5fae1ba3c5d3d611f2`. All 13 referenced file pins matched before edits. Browser effects were restored from the pinned client block; SSR was not treated as executed browser evidence. New component/cache names are restoration choices, not recovered historical filenames.

- Concurrent authenticated GETs publish only a complete snapshot. Account changes, abort generations and an irreversible 401/403 latch prevent old responses from restoring access.
- React snapshot rows contain sanitized metadata. Preview contact/text live in a volatile map with a monotonic deadline, request latency, a maximum remote duration of 24 hours, and epochs that reject content begun before a clear. Clear retains deadlines and never extends them; no persistent browser storage is read, written or purged.
- Local expiration and visibility/blur/focus clearing remove previews without requiring another read. Existing polling remains 15 seconds after settle, with its own cancellation and focus behavior.
- PATCH uses confirmed revisions and a fresh UUID, guards duplicate submission, and never applies optimistic state or automatic retries. A 409 blocks controls until both refresh reads succeed. Status replacement preserves the inbox; conversation replacement affects only an existing ID.
- Exact manual form values, connection control predicates, human/review actions, conservative status copy, Colombia dates, semantic names and responsive classes follow the frozen client. Ordinary business bot controls and copilot code are unchanged.

## Validation

Preimplementation tests resolved explicit placeholder modules: 50 cache/platform tests failed on missing behavior. Two page integration tests also failed, but their initial failures were a renderer setup error (`self is not defined` in Next Link), not semantic RED. This distinction is retained in the private report. The initial implementation passed 49/52; correcting the page Link test double and creating a separate synthetic Response for each GET produced 52/52 without a production change. Eight additional characterization cases passed in the final run.

Final commands used Node 24.22.0, locked pnpm 11.23.0 dependencies, `envDir:false`, external TEMP/TMP and at most four workers:

| Check | Result |
| --- | --- |
| New cache, component and page integration suites | 60 passed |
| Existing copilot UI, commercial conversations, API polling, auth provider and client API suites | 34 passed |
| `tsc --noEmit --incremental false` | Exit 0; no diagnostics |

The eight selected suites passed together (94 tests). Existing dependency suites were run once in this cut. Raw stderr retains `react-test-renderer is deprecated` warnings; they were not suppressed. No full suite, build, application server, Firebase emulator, provider/network action, activation or deployment was performed.

## Limits

Tests use synthetic transport below the real API client, real polling, fake monotonic time, EventTarget listeners and the repository's React renderer conventions. Page wiring tests substitute child components and Next Link; existing auth/copilot/commercial suites provide their separate boundaries. No frozen bundle was executed and no differential browser oracle is claimed. Roles, labels and responsive classes were inspected/tested, but actual tab navigation, layout, desktop/small-screen rendering and browser lifecycle QA remain later P0/P2 work.

Visual disappearance of content does not prove remote deletion; metadata retention remains the existing server contract. This cut does not establish connection/coexistence, P0 completion or deployment readiness. Controller review remains required.
