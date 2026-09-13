---
title: "Restaurant visits and reviews use one clear flow"
status: review
created: 2026-09-13
updated: 2026-09-13
---

# Restaurant visits and reviews

## Outcome
Check-ins and meal logs describe repeatable visits. Add a review to the exact selected check-in in the familiar composer; show a clear saved state and read-first review action. New visit starts another occasion explicitly.

## Done when
- [x] Existing visit enrichment preserves ID, count, creation time and optional date.
- [x] Same-day repeats remain separate and retry/double taps do not duplicate.
- [x] Current composer supports full review fields together, with failed draft/photo retention.
- [x] Reviewed status, read-first review action, New visit and older history are distinct.
- [x] Independent reviews and local required checks pass; CI pending.
- [x] Native dev-client changed states verified read-only and screenshots recorded.
- [ ] Approved production database-function update deploys via CI, TestFlight wrapper completes and worktree cleanup is verified.

## Constraints
User approved the visit model and implementation on 13 September. Own Codex design and native adversarial review per explicit user override of inherited model-routing rules. Places preview task resumed and coordinated; it owns Places cards. Socials audience/appearance remains undecided and unchanged. No live writes for QA. Existing visibility and private data are preserved.

## Technical design
Pass exact entryId into the existing native log-meal modal. Load an owned draft; refuse incomplete reads. Reuse atomic save_visit with additive field allowlist for likes, subratings, companions and Table selections. Skip unchanged audience arrays. New meal submissions retain a snapshot/nonce until confirmed. Patch history using the confirmed row and select its ID through an owner/page-scoped return signal. Review reading uses entry-detail's default read mode.

## Notes / Blast Radius
1. PostgREST embeds: no tables/FKs/RLS are added or changed. Existing restaurant, profile, entry photo, companion and Table embeds remain structurally compatible. New owned-draft reader explicitly omits revoked entries.table_id and reads entry_tables instead.
2. SQL/RPC callers: fn_save_visit(uuid,uuid,jsonb) retains its signature and old rating/content/date/photo patch support. Only entry/visits.ts invokes it in application code. Existing record/date/undo helpers and SQL tests remain compatible; fn_visit_entry_result is reused unchanged.
3. TypeScript: VisitPatch gains optional liked/subrating/companion/Table fields; SavedVisit gains optional audience IDs. New draft/selection hooks have separate owner-scoped query keys. No unrelated response type changes.
4. Edge contract: authenticated entry?action=save_visit expands its whitelist and returns additive audience IDs. Deploy entry in the same CI release as migration 20260913091351_visit_full_review_patch.sql, before TestFlight.
5. Reads/security: owner row lock, solo/gathering refusal, moderated photo binding and transaction rollback retained. Requested shares check/lock memberships; companions require mutual follows and neither block direction. Existing private visibility never defaults public. Existing readers still determine public eligibility.
6. Rollback: previous app accepts old save fields. Restore prior fn_save_visit after app rollback; no schema/data deletion needed. Migration replay and deployment smoke remain required.

## Progress and result
13 September: implementation approved by fresh independent app reviewer after resolving rejected-save correction, compound uncertain retry nonce retention, deleted selection recovery, missing-draft create fallthrough and untouched legacy photo handling. Separate independent SQL reviewer approved the function diff after rerunning the real-writer fixture suite and five races. Migration SHA-256 reviewed: 47cf0ad2a19225d7c2e60d731cce7616ecc8662bd8c11be2ce1e103e80f2984b.

Local checks: 224 app suites / 1,837 tests passed; all 777 Edge tests and 115 steps passed (8 intentionally ignored); TypeScript and full lint passed (238 pre-existing warnings, zero errors). Typography/route guards and whitespace passed. Initial Edge-suite dependency failure resolved by installing root packages exactly as CI does; no test bypass. Targeted final review reran 57 tests across actions/composer/loader suites. Full Supabase migration replay and production bundle export remain CI gates.

Native QA found and fixed a real PGRST200 from an invalid companion-to-profile embed. The owned draft now reads companion IDs and batch-fetches profiles separately. Regression mocks reject the invalid embed. Add review then loaded successfully in the simulator. No live review/check-in/share/photo mutations were made.

### Verification
Captures: `/Users/jacky/Documents/Codex/Napkin/restaurant-logging-2026-09-13-51fe/implementation-qa/`. Device: iPhone 16e D630916B-B2E6-4F3E-BBDB-27D9346549DA, iOS26.2, dev client com.majilaii.dining-journal-app, Metro8081. Fixture overrides changed only local display/input data for bare/empty states; exact source bytes restored and temporary backups removed before final checks. Metro stopped and simulator handed back to Places preview.

| State driven | Screenshot | Result |
|---|---|---|
| Reviewed restaurant with date/rating and two clear actions | 01-reviewed.png | Pass, live read-only |
| New visit choices | 02-new-visit.png | Pass, live read-only |
| New visit → current native meal composer | 03-new-meal-composer.png | Pass, completed modal transition, cancel without save |
| View your review → read-only saved meal | 04-review-reading.png | Pass, no edit form by default |
| Visit history | 05-history.png | Pass, original date/identity shown |
| Bare check-in with Add review / New visit | 06-checked-in-fixture.png | Pass, local display fixture |
| Exact owned draft loads with original date/content/tables | 07-owned-review-composer.png | Pass after explicit profile lookup fix; no save |
| Add review uses current composer with original visit date | 08-add-review-fixture.png | Pass, local bare-content fixture; no save |
| No visits: Check in / Log a meal | 09-empty-history-fixture.png | Pass, local display fixture |
| Draft loading and broken-read refusal/retry | Captured in task tool transcript | Pass; original PGRST200 fixed, no fallback to create |

Repeat writes, nonce retries, all-field rollback, null dates, stale audience/photo failures and selection deletion use isolated SQL/component/integration fixtures, not live writes. Release, CI and final cleanup evidence to follow.
