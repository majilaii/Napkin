# Background restaurant imports

Sharing a link currently creates a phone-local file. Processing begins when Napkin opens. This change submits an authenticated, durable server job from the share extension and reconciles its result into the existing review flow. Processing never pins a restaurant without confirmation.

## Scope and limits

Use the existing resolver, model, Places budgets and extraction quality gates. Direct named Maps links and sufficiently evidenced TikTok videos (including safely expanded aliases) can resolve on the server. Arbitrary web pages, short/list Maps URLs and unsupported source types retain their device path. A social link is ready only if the existing conservative evidence gate passes. Missing video perception becomes `needs_device`, then resumes through the existing native pipeline. The owner explicitly chose existing services for this release; separate cloud video compute is excluded. Do not silently substitute incomplete caption-only extraction for full video evidence.

The native extension submits a JSON file using background URLSession. An opaque, revocable intake-only credential lives in the shared Keychain; a user id is never authentication. Submission ambiguity retries the same job identity. Native callbacks write a separate transfer sidecar so they cannot overwrite review edits.

Server intake commits before starting work. Leases, bounded attempts, backoff, idempotent completion and a scheduled rescue cover interruptions. Results remain private to the owner. Import-only Expo push delivery uses device ownership, durable attempts and receipts; permission is requested only at the existing import moment. Existing on-device imports remain supported.

## Schema blast radius

- New `background_import_credentials` and `background_import_jobs` tables reference `auth.users`; scoped credentials also reference the originating `auth.sessions`. New push tables are private worker state. No new relationship joins two existing public entities; existing PostgREST embeds are unchanged. All new reads select explicit scalar columns, without embeds.
- New service-only RPCs handle enqueue, leased claim, completion and cancel-before-intake tombstones. Existing `import_jobs`, completeness RPCs, destinations, wishlist and Table writes keep their contracts. New resolver internal auth loads the owner and immutable request from the active lease and preserves per-owner Places limits.
- RLS is enabled on new tables with no public policies; table/RPC grants are revoked from public, anon and authenticated. Edge endpoints validate JWTs or scoped credentials, including expected owner, before service access. Account deletion cascades new private state.
- `background-imports` is a new Edge Function. `resolve-url`, `notifications` and the scheduled rescue transport deploy with the migration. The existing completeness schedule remains compatible.
- Local manifest parsing preserves the additive remote job identity. Existing account-keyed import query keys remain; synchronization only exposes the active owner's originating-device results. Notification taps retain the owner guard and imports hub parent route.
- No optimistic restaurant or wishlist mutation is introduced. Durable local results are checkpointed before review; existing save nonces and confirmation paths remain authoritative.

## Verification and release

Test credential/owner rejection, nonce reuse, concurrent claims, lease expiry, cancellation, timeout after acceptance, retries, terminal failure, ready-result reconciliation, no premature local fallback, account switching, and notification tickets/receipts. Run SQL contracts against an isolated database, function tests, app tests/typecheck/lint and native tests. Build the iOS dev client and inspect changed states with isolated import fixtures; live app data remains read-only. Obtain fresh independent adversarial review before merge. Release only using `scripts/release-testflight.sh <merged-sha>` and verify release/task worktree cleanup.

## Observed verification

- Independent adversarial review approved the implementation after fixes for cancellation before upload acceptance, notification recovery fairness, deterministic rejection, account changes and originating-device push delivery.
- Full function suite: 856 passed, 8 existing ignored; extraction evaluation unit suite: 9 passed. The final app suite is recorded with the release PR.
- All 175 migrations replayed from scratch on isolated PostgreSQL 17.6. Both new SQL specs passed as real backend/client roles; final input hashes matched. Disposable containers, volumes and copied replay projects were removed.
- Native tests cover background transport/auth outcomes and existing video/speech behavior. Fresh iOS debug build succeeded for app and share extension; generated app entitlements include APNs and the shared App Group.
- Running native UI evidence: `artifacts/background-imports-2026-09-13/progress.png` shows background processing, waiting for connection, failed recovery and a ready review; `review.png` shows the prepared restaurant held before saving. These use a disposable simulator, dummy owner, App Group fixtures and a temporary Metro harness that rejects external requests. Save/retry/cancel write paths are covered by tests. The harness is removed before commit.
- Physical-device background transfer and APNs delivery remain release verification limits; simulated UI, provider tickets and receipts are not claims of physical delivery. After installing this native build, open Napkin once while signed in to provision its scoped intake credential. iOS still controls upload timing, especially after force-quitting or without connectivity.

- The native shared Keychain was exercised in the installed dev client: scoped credential write/read both returned true. `share.png` records Napkin present in the native Safari share chooser. The final system-share destination tap could not be automated (Simulator coordinate actions returned `noWindowsAvailable` and the row was absent from accessibility data), so runtime upload sidecar creation remains a device verification limit; native submission/response tests and app/extension compilation passed.
