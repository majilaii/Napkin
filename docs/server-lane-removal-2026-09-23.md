# Removing the retired server import lane (TICKET-249)

TICKET-248 (PRs #393 and #394, 23 September 2026) moved every shared import onto the phone and left the PR #387 server lane in place but idle. This ticket deletes the parts nothing calls any more and writes up the table drop for approval. There is no migration and no app change.

## Evidence (read-only, 23 September 2026, about 20:25 UTC)

Production figures came from one aggregate SELECT through the Supabase Management API. No row contents were read and nothing was written.

- `background_import_jobs` holds 12 rows from one owner on one installation: 8 `failed` (`temporarily_unavailable`), 3 `dismissed`, 1 `needs_device`. None is `pending`, `processing` or `ready`, and none was created after the TICKET-248 deploy (17:11 UTC); the newest is from 22 September, 18:44 UTC.
- No `ready` job, no `import_push_deliveries` row and no `import_resolutions` row with evidence path `background` was present at the audit. That is a snapshot, not lifetime history: push revocation deletes delivery rows, and account deletion removes jobs and provenance.
- `import_push_devices` has 2 active rows, last written 15:42 UTC on 23 September, so installed builds still register Expo tokens.
- `background_import_credentials` has 6 rows (5 active) across 6 installations and 3 owners; the newest is from 17 September.
- Deployed `background-imports` is version 10 (17:11:24 UTC, the prod-deploy run for da4bc5b). Its downloaded bundle has no `fetch` and no call to `resolve-url`; the worker only claims jobs and finishes them as `needs_device`.
- The cron's background-imports step returned `{"processed":0}` on every run since 01:44 UTC on 23 September.
- Edge logs keep about a day. In that window `background-imports` received no `enqueue`, one JWT `status` (about 14:58 UTC, before the TICKET-248 deploy, so from build 262 to 264) and two probes from the TICKET-248 session.

Callers, read from each build's source:

| Build | Source | Calls |
|---|---|---|
| 262 | c1670cc | extension `enqueue`; app `status`, `enqueue` after a 404, `dismiss`, `register_intake`; native `revoke_intake`; push device registration |
| 263 | 751aa63 (App Store resubmission) | same as 262 |
| 264 | 578ce32 | same as 262 |
| 265 | 5a1c621 | extension `wake`; app `register_intake`, `dismiss` for legacy manifests; native `revoke_intake`; push device registration |

The smoke suite calls `list`. Only the cron called `drain`. No client version ever called `acknowledge`, `retry` or `list`, and nothing calls `resolve_background`.

## What this removes

- `resolve-url`: the `resolve_background` action and `background.ts`, `backgroundFastPath.ts`, `backgroundSourceUrl.ts` with their tests, plus what PR #387 threaded through for them (the oEmbed `redirect` option, the internal-secret parameters on `handleUrlResolve`, `handleVideoText` and `resolveStagedPlacesParallel`, and the Maps branch's rethrow for the worker). The `parsePlaceFromMapsUrl` wrapper had no other caller and goes too.
- `background-imports`: the worker, the enqueue kick, the scheduled `drain` action, the ready-notice producers (`notifications.ts`), and `acknowledge` and `retry`.
- `_shared/importPush.ts`, the Expo push producer and dispatcher. `EXPO_PUSH_ACCESS_TOKEN` is now unused and can be unset separately.
- The `background-imports` job in `restaurant-completeness-cron.yml`.

The cron was the only rescue for a job left `pending` (the enqueue handoff failed and so did the kick) or `processing` (a kick claimed it and never finished). Builds 262 to 264 show "processing in background" and never fall back to the phone while `status` reports either state, and they poll `status` every five seconds in the foreground and on every background wake. `status` now hands such a job to the device before reading it, for the calling owner only and whatever its lease; a worker from before this deploy that finishes afterwards fails its lease check. `supabase/tests/background_imports.spec.sql` runs the same statement against a replayed database, and three deliberately broken versions of it (no owner filter, lease not cleared, processing rows skipped) each fail the spec.

## What stays, and why

- `register_intake`, `revoke_intake`, `wake` and `background_import_credentials`: build 265's share wake.
- `enqueue`, `status`, `dismiss` and `background_import_jobs`: builds 262 to 264, and 265's `dismiss` for legacy manifests. `list` stays for the smoke check.
- Push registration in `notifications` and `import_push_devices`: every installed build still registers. Nothing sends to those tokens now.
- The app's legacy `remoteJobId` handling. Jacky's condition was to keep it while builds 262 onward may still hold legacy manifests. Builds 262 to 264 are still installable (TestFlight builds last about 90 days, and 263 was built for the App Store resubmission; its store status is not recorded here), one of them called `status` on 23 September, and 5 intake credentials are active, so those manifests can still be created and carried into an upgrade.

## Deploying it

Deleting a `_shared/` file makes prod-deploy redeploy every function, and the workflow edit also triggers it. A green smoke run is not enough here: smoke calls `list`, which the old handler also answers, and the auto-revert PR only opens on smoke or cron-gate failure. After merge, check that the whole prod-deploy run succeeded, that `supabase functions list` shows a new `background-imports` version, and that its downloaded bundle has the `status` handoff and no `drain`. If `background-imports` failed to deploy, redeploy it with `gh workflow run prod-deploy.yml -f functions=background-imports`; if that cannot succeed, revert this PR so the cron and the old worker come back together.

## Proposed table drop (not applied, needs Jacky's approval)

None of this is under `supabase/migrations/`. Each phase is its own PR and needs an explicit yes, because it deletes data. `background_import_credentials` stays in both: the wake authenticates with it.

A single migration now would break installed builds, so the drop comes in two phases with different gates. prod-deploy applies migrations before it deploys functions, so in each phase the code change ships in an earlier release and is verified live before the migration.

### Phase B: import-only push

Gate: a released and verified change in which `notifications` answers `register_import_device` and `unregister_import_device` with their current success shape without touching the tables. Builds 262 to 265 call both.

```sql
begin;
drop function if exists public.fn_claim_import_push_deliveries(integer);
drop function if exists public.fn_revoke_import_push_device(uuid, text, uuid, bigint);
drop function if exists public.fn_register_import_push_device(uuid, text, uuid, uuid, text, bigint);
-- Deliveries reference devices, so they go first.
drop table if exists public.import_push_deliveries;
drop table if exists public.import_push_devices;
commit;
```

Same PR: delete `supabase/tests/import_push.spec.sql` and its lines in `.github/workflows/migration-replay.yml`, and `notifications/importPushDevice.ts` with its test. Data lost: 2 device rows holding Expo tokens nothing sends to, and 0 deliveries.

### Phase C: the job queue

Gate: builds 262 to 264 retired. The last of them, 264, was uploaded on 23 September and TestFlight builds expire after about 90 days; 263 must also be off the App Store with its users updated. Those builds compare the `status` answer against the manifest's job id, import nonce and URL, and treat any error as "waiting for connection" without falling back to the phone. `status` only receives the job id, so no table-free stub can answer them, and dropping the table early strands their legacy imports. Build 265 swallows `dismiss` failures.

Earlier release, verified live: remove `enqueue`, `status` and `list` from `background-imports`, make `dismiss` answer `{ ok: true }` without storing, and drop the `background-imports?action=list` smoke check.

```sql
begin;
-- fn_enqueue and fn_claim return the table's row type, so all four go first.
drop function if exists public.fn_enqueue_background_import(uuid, uuid, uuid, jsonb, uuid, uuid);
drop function if exists public.fn_claim_background_imports(uuid, integer);
drop function if exists public.fn_finish_background_import(uuid, uuid, text, jsonb, text, integer);
drop function if exists public.fn_dismiss_background_import(uuid, uuid, uuid, jsonb);
drop table if exists public.background_import_jobs;
commit;
```

Same PR: cut `supabase/tests/background_imports.spec.sql` down to its `background_import_credentials` checks (RLS, grants, session-revocation cascade, owner isolation) and keep its migration-replay line. Deleting the whole spec would drop security tests for a table that stays. Data lost: 12 job rows, all failed, dismissed or needs_device.

### Blast-radius checklist (CLAUDE.md)

1. PostgREST embeds: none. The tables are service-role only; the one foreign key between them is deliveries to devices, handled by the drop order, and nothing else references them. No `.select()` embeds them.
2. Direct SQL and RPCs: only the two creating migrations (`20260913201042`, `20260913200921`) and the two specs reference them. `check_and_increment_rate_limit` keeps stale `background_import` and `background_import_dismiss` bucket rows, which are harmless; `import_intake_registration` stays live with `register_intake`.
3. RLS: enabled with no policies, and the grants go with the tables. Account deletion is unaffected: the `on delete cascade` keys to `auth.users` and `auth.sessions` disappear with the tables, and no deletion function names them.
4. Edge contracts: `notifications` before phase B and `background-imports` before phase C, each released first.
5. TanStack keys and hooks: none read these tables (`queryKeys.importJobs` is the separate `import_jobs` table).
6. Optimistic patches: none.
