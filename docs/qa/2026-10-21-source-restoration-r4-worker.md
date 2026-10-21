# P0 R4 Worker restoration QA

Restores the frozen v24 platform retention and Worker configuration bridge on reviewed BASE `4f10cb2ff1f5e188c701ffbed35dae0c16b79769`. This is source restoration evidence; P0 is incomplete and nondeployable.

Authority: recovered Worker SHA-256 `760a78f07c1211cc59e2fc8dac5d0d82512a6e39c0ec6456ab404c0effcf42e0`, runtime keys L1733–1746, retention L2368–2433, scheduled L2469–2475. The primary contract hash is `e049665d865f236471cca76bf987dad2fa732bc7edb00bc727b1b5c9d0f1e638`. Type declarations and tests are reconstructed interfaces.

- Four ordered, ascending, bounded D1 phases erase event/conversation bodies and then delete event/conversation metadata. Structural guards cover all stored scopes; invalid records remain untouched. TTL, record revisions and other retained fields are preserved.
- Conflict retries reread the current revision. Other failures reuse the commit UUID and fingerprint for journal recovery. Each phase has at most three attempts; all phases continue after normal failure. Aggregate warnings contain counts only.
- Fourteen optional strings pass unchanged through the existing runtime bridge. A manual declaration augments both binding interfaces; generated `worker-configuration.d.ts` is unchanged. Existing identity, backend, engine, singleton and Container lifecycle remain intact.
- Scheduled cleanup requires exact string `true` and maintenance other than exact string `true`; cleanup and aggregate logging precede legacy wake. Platform flags alone neither wake nor renew the Container.

Behavior-visible RED used a resolved no-op retention export: 13 failed/2 passed before implementation. The first run exposed an SDK fixture mismatch; the corrected fixture repeated RED before production changes. Initial GREEN passed15. Three supplemental assertions added after GREEN cover exact phase order, invalid expired records and atomic rollback; no production changes followed them.

Final verification: **71/71** affected Node tests passed (18 new plus existing data, router and lifecycle checks); app and Worker TypeScript passed with no diagnostics. Node24.22.0 and cached pnpm11.23.0 were verified. Synthetic local Miniflare D1 exercised the actual schema, flat JSON codec, CAS conflict/reread, lost-response replay, rollback, no R2 access, expiry equalities, empty/full lots and the 200-write bound. Existing data checks also preserve limits, private transport, journal and payment/logo behavior. Node emitted the existing `MODULE_TYPELESS_PACKAGE_JSON` warning for shared TypeScript modules; raw logs retain it.

No environment files, credentials, real records, remote backend, app/Firebase server, additional application replica, keepalive, activation, push or deployment was used. Full app suite/build and package-wide Worker dry run remain final P0 gates. Invalid rows can occupy future lots; a full lot conservatively reports pending. Cron deployment and a fresh Container process/environment are operational checks outside this cut. Raw commands, extraction, hashes and failed attempts are private under package `evidence/p0-r4-worker/`.
