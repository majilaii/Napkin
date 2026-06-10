# Napkin — Project Status

_Generated 2026-06-01, after ~5 weeks idle. Last commit: 2026-04-29. Deploy files dated 2026-04-30._

---

## ✅ Reboot log — 2026-06-01

Done this session:
- **Prod resumed** (was paused) — data intact, schema verified in sync (all 73 migrations).
- **`origin/main` reconciled** to deployed reality: PR #55 merged 043/044 + deploy pipeline + restaurant-history FK fix + composer/profile polish (6 commits, rebased). `main` was PR-protected (rulesets: "No main/master push" + "Copilot review"), merged via `--admin`.
- **Fixed a real pipeline bug**: `prod-deploy.yml` had a YAML startup failure (auto-revert PR body broke the `run:` block scalar). Repaired via PR #56. Workflow now parses clean.
- **Branches cleaned**: deleted merged `reconcile/2026-06-01`, `fix/prod-deploy-yaml`, `feat/TICKET-050`.

Remaining (handoff):
- **Deploy pipeline not yet operational** — needs 3 repo secrets: `PROD_ANON_KEY`, `PROD_SMOKE_TEST_RESTAURANT_ID`, `PROD_SMOKE_TEST_JWT` (only `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` are set). Until added, any deploy fails *safely* at the secrets guard (no prod mutation, no auto-revert).
- **4 stale branches** still need triage: `feat/ghost-restaurant-page` (1), `fix/edge-fn-error-propagation-and-round-race` (2), `spike/TICKET-051-share-ext` (6), `spike/TICKET-052-tiktok-webview` (4) — each has unmerged commits, so deletion needs a decision.

---

## ✅ Resolved: prod was paused, now resumed — data intact

The repo points at Supabase project ref **`ftvmseaqwwlcxtdlvxxz`** (eu-west-2). It had **auto-paused** after ~5 weeks idle (free tier pauses at 7 days). User resumed it 2026-06-01. After resume: REST gateway came up first (HTTP 401), DB pooler registered the tenant ~160s later. **Paused ≠ deleted, so all data, auth users, and storage are intact.** My initial NXDOMAIN reading (deleted) was wrong — it was just the paused state not resolving DNS.

### Migration sync — the original question, answered
`supabase migration list --linked` after resume: **all 73 local migrations are applied on prod, Local and Remote columns match for every row** — including the entire `20260509*` batch (the TICKET-043/044 multi-table + round-merge work). Schema is fully in sync; nothing pending, nothing drifted.

### The real gap: prod is AHEAD of the git remote
The 043/044 **migrations are in prod**, but the 043/044 **git commits never reached `origin/main`** (local `main` is 2 commits ahead). Migrations were pushed to prod directly from the laptop (per the user's standing habit); the `git push` never happened. So git history is *behind deployed reality*, not ahead of it.

### ✅ Edge-function check — restaurant page is NOT broken (fix already live)
Verified by downloading the deployed `restaurant-history` (v22, 04-30) and comparing: it carries **both `!entries_table_id_fkey` disambiguations** (count = 2, matching the fixed local copy). The only remaining bare `tables(...)` embeds are on `table_members` / `table_nights` — single-FK, so not PGRST201-ambiguous. The uncommitted working-tree fix == what's already deployed; it was shipped 04-30 from a dirty tree (deploys ship from filesystem, not git) but **never committed to git**. So this is git hygiene, not a live bug. (The `__DEV__` error display on `restaurant/[id].tsx` was the debugging breadcrumb from that session — also fine to keep or drop.)

### Orphan edge functions in prod (not in repo)
Prod has ~9 ACTIVE functions with no source in the repo: `foursquare-search`, `review`, `get-reviews`, `table-members` (supposedly deleted in TICKET-039!), `table-wishlist`, `social`, `user-companions`, `backfill-photos`, `__test_deploy__`. Stale, not harmful — candidates for cleanup.

> The Supabase MCP in this session is a **different account** (only sees `majilaii's Project`, `fwtxlbjnjfzqmqqmsssb`). All prod inspection above was via the linked CLI, not MCP.

---

## What Napkin is

"Letterboxd for restaurants, with a private supper club." Mobile app (React Native / Expo) for cataloguing meals — solo or with friends — inside private groups ("Tables"). Doctrine (locked 2026-04-20): **individual-first, Tables emerge**; profiles public-by-default, logs private-by-default, Tables never public. Rounds (group rating events) are a side mode, not the hero.

Stack: Expo + Expo Router · TanStack Query · Reanimated · Supabase (Postgres + Auth + Edge Functions + Realtime). Design system = "Heirloom Journal" (warm paper, italic Newsreader).

---

## Product scope — what's shipped

The kanban board is **empty in every column except `done/`**: **59 tickets** closed (TICKET-001 → 059). The app is feature-complete against everything that was specced. Surfaces built:

| Area | Status |
|---|---|
| Auth, Tables CRUD, membership | ✅ 001–002 |
| Feed + journal + filters/views | ✅ 003 |
| Logger / entry composer + metadata | ✅ 002, 004, 011, 019 |
| Photos (restaurant, entry, shared pool) | ✅ 005, 005b, 006b |
| Rounds (live, presence, reveal, recap) | ✅ 006, 006c, 013 |
| Reactions & replies | ✅ 007 |
| Restaurant entity + page v2/v3 + search | ✅ 014, 016, 017, 031, 041 |
| Wishlist (personal + emergent Table merge) + by-city + link import | ✅ 015, 040, 045, 053, 054 |
| Member/public profiles + follow graph | ✅ 012, 020, 028 |
| Lists primitive + public reviews | ✅ 018, 021 |
| Top Fours (table + personal/regional) | ✅ 046, 047 |
| Notifications inbox | ✅ 048 |
| Professional critics + ingestion + Atlas | ✅ 026, 030, 033 |
| Calibration signal (Ring 2 groundwork) | ✅ 022 |
| Emergence arc (looking-back, seed-from-solo) | ✅ 032 |
| **Multi-table per entry** (`entry_tables`) | ⏳ 043 — built, committed locally, **NOT pushed/deployed** |
| **Round merge** (same-meal logs collapse into a round) | ⏳ 044 — built, committed locally, **NOT pushed/deployed** |
| Hardening: RLS lockdown, pagination, optimistic cache, edge correctness, N+1 | ✅ 034–039, 042 |
| iOS share extension / TikTok spikes | 🔬 051, 052 — spike branches, not merged |

19 edge functions, ~25 app routes, 20 component dirs, 14 hook dirs. (Inventories at bottom.)

---

## Repo / code state

### Local `main` is 2 commits AHEAD of `origin/main` — never pushed
```
c77374b feat: TICKET-044 — same-meal logs become a round
e689ce7 feat: TICKET-043 - Multi-table per entry
```
**52 files, +5,669 / −544 LOC. 26 new migrations** (`entry_tables`, SECURITY DEFINER helpers, round-collapse triggers, atomic entry RPCs, multi-table notifications/post-interactions) + 9 edge functions rewritten + a `tests/entry_tables_leak.spec.sql`. This is the largest single chunk of unsynced work and it touches **schema + RLS + edge contracts** — exactly the high-blast-radius category. It never reached `origin/main`, so the CI deploy path never ran on it.

### Uncommitted working-tree changes (not committed at all)

**(a) Auto-deploy pipeline — written, never committed.** The safety net built after "3 prod fires in a week":
- `+ .github/workflows/prod-deploy.yml` (174 lines: db push + edge deploy + smoke + auto-revert PR)
- `+ scripts/smoke/edge-functions.ts` (HTTP-200 + shape sniff per critical endpoint)
- `+ DEPLOY_RUNBOOK.md` (163 lines)
- `M CLAUDE.md` (+53 lines "Deploy doctrine" section)
- `D .github/workflows/db-push-on-main.yml` (old workflow, staged for deletion)
- **Catch-22:** CLAUDE.md now declares "merge to main → CI deploys," but the CI workflow itself is uncommitted — the doctrine is live, the machinery isn't.

**(b) Feature polish — uncommitted:**
- Composer location bias fix — `getLastKnownPositionAsync` + 10km radius + try/catch (`create-entry.tsx`, `ComposerMasthead.tsx` adds a "change" affordance)
- Profile rows made tappable → navigate to entry/restaurant (`DiaryRow`, `RegularRow`, `RegularsRail`, `TopFour`)
- PGRST201 FK disambiguation in `restaurant-history/index.ts` (`tables!entries_table_id_fkey`) + dev-only error display on `restaurant/[id].tsx`

### Branches — no open PRs anywhere
| Branch | Ahead of main | Note |
|---|---|---|
| `spike/TICKET-051-share-ext` | 6 | iOS share extension spike |
| `spike/TICKET-052-tiktok-webview` | 4 | TikTok webview spike |
| `fix/edge-fn-error-propagation-and-round-race` | 2 | unmerged fix |
| `feat/ghost-restaurant-page` | 1 | likely superseded by 041 |
| `feat/TICKET-050` | 0 | already merged |

---

## Risks & open questions

1. ~~Prod backend existence~~ — **resolved**: paused → resumed, data intact, schema in sync.
2. **Git behind prod (main risk now).** `origin/main` is missing the 043/044 commits that are already live in prod. Any fresh checkout, CI run, or collaborator would deploy edge functions *without* the 043/044 code against a schema that *has* it → exactly the PGRST201-class fire the deploy doctrine was written to stop. Push local `main` → `origin/main` to realign.
3. **Uncommitted-but-deployed work = git hygiene debt.** The `restaurant-history` FK fix is verified already live (just not committed). Same for the feature polish on the *client* side — though client changes only reach users via a new app build, so location-bias / tappable-rows are pending an Expo build, not a server deploy. Commit everything so git matches reality.
4. **Deploy pipeline still uncommitted & never run.** `prod-deploy.yml` references the prod ref + smoke list; needs committing + a first validation run.
5. **Pushing to `origin/main` will trigger the OLD CI.** `db-push-on-main.yml` still lives on `origin/main` (its deletion is staged but uncommitted). A plain push fires it — a re-`db push` (idempotent no-op since all migrations are applied) but worth sequencing deliberately vs. landing the new pipeline first.
6. **Orphan prod edge functions** (`table-members`, `social`, `review`, etc.) — stale, low priority cleanup.

---

## Recommended next steps (in order)

1. ✅ **Confirm prod state** — done: paused → resumed, schema in sync.
2. **Commit + deploy the `restaurant-history` FK fix** (and the create-entry/profile polish). Per the user's standing habit, `npx supabase functions deploy restaurant-history --project-ref ftvmseaqwwlcxtdlvxxz` — *but* note this conflicts with the (uncommitted) "CI-only" deploy doctrine. Decide which rule governs before deploying.
3. **Realign git: push local `main` → `origin/main`** so deployed reality and git history match. Sequence against the stale-CI trigger (item 5 above) — ideally land the new pipeline / drop the old workflow first.
4. **Commit the deploy pipeline** (`prod-deploy.yml`, smoke, runbook, CLAUDE.md doctrine) and do a first validation run so there's a real safety net.
5. **Triage stale branches** — merge the error-propagation fix if still relevant; close out the spikes; delete `feat/TICKET-050` (merged) and `feat/ghost-restaurant-page` (superseded by 041).
6. **(Later) Clean up orphan prod edge functions.**

Note: local dev is unaffected — `supabase start` (local Docker) works regardless of remote state.

---

## Appendix — inventories

**Edge functions (19):** critics-admin, entry, feed, lists, member-profile, notifications, places-photo, places-search, post-interactions, resolve-url, restaurant-history, table-activity, table-atlas, table-management, table-night, top-fours, user-profile, wishlist

**App routes:** (tabs)[feed, journal, log, profile, search, tables], auth, create-entry, diary, entry-detail, follows, import, lists, looking-back, notifications, regulars, seed-from-solo, settings, table-night, table-night-detail, top-fours, wishlist, restaurant/[id], member/, u/, list/, table/, admin/

**Migrations:** 73 local files; latest batch `20260509000000`–`20260509000250` (the unpushed 043/044 work).
