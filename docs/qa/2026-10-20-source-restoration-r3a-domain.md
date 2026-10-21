# Platform WhatsApp domain restoration (P0-R3a)

Base: `6aedaf69911ad59b6ac2696294e1bbd8b2a61485`. This cut restores the published v24 control/status, normalized ingress and private conversation domain. **P0 remains incomplete and nondeployable.** No routes, observer, UI, retention dispatcher, provider calls or automation were added.

## Provenance

Exact factories were extracted by UTF-8 byte offsets and hashed before implementation; only selected factories executed in the private differential harness.

| Factory | Artifact / byte interval | Factory SHA-256 |
| --- | --- | --- |
| 9243 | `_184luam3laidp._.js` [6256,11370) | `4ccbbbfc63b1f6b2a34867e52e486d46852ed70ec296676778e3d8d513489d10` |
| 5649 | `_1lf_szebty9mg._.js` [7178,12826) | `178cad11dcedf3e2b46f17bb62893d09bc9c0321b0ae927615dad6215961c5f1` |
| 50437 | `_1gczh0fxu1ayr._.js` [7051,9493) | `a90c4d05a61949e623cbf3a126de74e442cc5fc6e532027aae83b7d073374383` |

The corresponding artifact hashes are `e2528c02eff7b381bd53945f2d36b1f7d98c015e723a63677df638b23afae57e`, `6267cb770d0881607624362d4cc79f51ade873d31c2c8d0c5e6f7bad21d52727`, and `5b4f4eb838404bbbb46fdb6824ee222aaeed597721e3cea98e934948a9ea2ca4`. Source/type names are restoration interfaces, not recovered historical filenames. `platform-whatsapp-store.ts` documents the full 9243 export map; ingress maps 5649.f and conversations map 50437.I/c.

## Preserved behavior and protocol dependency

- R2 records/config/crypto and existing Database/HttpError are reused. Ingress requires the trusted caller to authenticate YCloud; no unsigned public entry point exists.
- Controls use parsed-body SHA identities, revision checks, atomic audit and replay before revision checks. Registering a connection preserves pause; first connected status without activity remains `automation_blocked`.
- Unverified, unpaused ingress remains allowed. Normal messages preserve domain revisions; aliases inherit original timestamps/TTL. Conflict markers and related conversation review behavior retain v24's existing scope handling.
- Content is separately encrypted under each exact document path. Private views hide expired/invalid content. Ingress uses Zod codepoints while presentation retains the manual 4,096 UTF-16 unit limit.
- Two proven protocol dependencies move forward from R4: only the parent collections `platformWhatsAppEvents` and `platformWhatsAppConversations`, and only numeric `updatedAt` in the Worker query whitelist. Children and other query fields remain denied.

## Validation

Node 24.22.0, locked pnpm 11.23.0 dependencies, environment-file loading disabled, external TEMP/TMP, maximum four workers.

| Gate | Result |
| --- | --- |
| New store / ingress / conversations / local D1 suites | 22 / 39 / 17 / 9 passed |
| Existing `tests/cloudflare-database.test.ts` | 9 passed; selected Vitest total 96 |
| Existing `cloudflare/tests/data.test.mjs` | 22 passed |
| App TypeScript, incremental disabled | Exit 0 |
| Worker TypeScript | Exit 0 |
| Isolated frozen-factory differential | 253 comparisons across 25 scenarios, matched |

Local D1 uses the existing Miniflare fixture and real Database adapter with two independent handles. Assertions cover concurrent controls/ingress, deterministic CAS against a concurrent pause, alias TTL, atomic manual control, identical ciphertext/UUID on lost durable response, and full rollback after an injected later create collision. The fixture does not start the application server or contact a real endpoint.

Tests were written before implementation; their first run failed on missing modules. A subsequent postimplementation placeholder sensitivity run produced 62 behavioral failures and seven passing validator tests. This is **not** historical behavioral RED before implementation. The ordering limitation is retained in the private report. The first oracle attempt failed its cross-VM array-prototype assertion; per-element dependency identity checks fixed the harness without changing production code.

The private oracle rejects unexpected imports/exports, blocks default backend access, uses synthetic config/clock/DB and deterministic test-only nonces, and executes no whole chunk, Firebase module, route, observer or network code. It compares result/error, full persisted records (including ciphertext) and operation sequences; concurrency is covered separately by real D1. Committed tests need no frozen/private artifact.

Full suite/build, HTTP/session behavior, observer, UI, remaining Worker/retention, branding and final parity remain deferred. Raw logs, extraction, vectors, audit and full report remain outside the committed deliverable in the private recovery package.
