# App Store Runbook — Napkin (iOS)

> End-to-end path from "TestFlight-only" to a public App Store release.
> Written 2026-07-10. Committed to the repo on purpose — the previous copy
> lived in a worktree and died with it.
>
> Local (gitignored, `/Users/jacky/Napkin/.kanban/`) companions:
> `APP-REVIEW-NOTES.md` (demo creds + paste-ready reviewer notes),
> `ASC-APP-PRIVACY.md` (label fill-in guide), `LAUNCH-RUNBOOK.md` (GTM stages
> + ASO pack). Those survived — they live in the main checkout, not the worktree.

## 0. Where things stand (2026-07-10)

| Fact | Value |
|---|---|
| Bundle ID | `com.majilaii.dining-journal-app` |
| ASC app ID | `6778759411` (wired into `napkin-app/eas.json` submit profile) |
| EAS project | `21d56495-18b4-46c9-9a81-673649cc1dca`, owner `majilaii`, slug `dining-journal-app` |
| Display name | Napkin (`CFBundleDisplayName`; slug stays `dining-journal-app`) |
| Version | 1.0.0, `appVersionSource: remote`, build auto-increments (TestFlight ~b149) |
| Devices | **iPhone-only** (`supportsTablet: false`) — deliberate: no iPad screenshot set, no extra review surface |
| Distribution | TestFlight live; public link **not yet created** (`constants/links.ts::TESTFLIGHT_INVITE_URL` is still `null`) |

**Compliance already shipped** (TICKET-090/091/110/121): account deletion
(5.1.1(v), Settings → bottom), report + block + blocked-users screen (1.2),
legal site live at `napkin-legal.vercel.app` (privacy/terms/support), Sign in
with Apple (4.8 — mandatory because Google sign-in is offered), password-reset
deep link, `ITSAppUsesNonExemptEncryption=false`, foreground-only location
strings, local-only notifications (aps-environment stripped at prebuild),
demo-account seeder (`scripts/seed/demo-accounts.ts`), Sentry crash reporting.

**What's left is founder-side ASC work** — §3 is the checklist.

## 1. When to actually release

App Review approval and the marketing push are separable. The GTM gate
(LAUNCH-RUNBOOK): a cluster you're not in hits **D7 ≥ 40% AND ≥ 30% of entries
tag a friend AND ≥ 1 Table forms organically**. Recommended play:

1. Get **approved early** with **Manual release** selected — the approved build
   sits unreleased until you click. Approval takes 24–48h typically; you don't
   want it on the critical path later.
2. Release quietly whenever ready (a listing nobody links to is effectively
   private). Save featuring nomination / any push for after the gate.
3. App Store **Featuring Nomination** (free, in ASC) needs 2+ weeks lead —
   the Heirloom aesthetic is genuinely featurable.

## 2. Build & submit (mechanical, per release)

Doctrine from the TestFlight builds — every trap here has been hit once:

```bash
# Build and submit only through the cleanup-safe wrapper.
scripts/release-testflight.sh <merged-sha>
```

- Manual release worktrees are prohibited. The wrapper verifies the commit is
  merged into `origin/main`, creates a unique worktree under the system temp
  directory, and installs dependencies fresh. Never create
  `/Users/jacky/napkin-build-*` again.
- The wrapper holds an exclusive release lock until submission and cleanup are
  finished. A concurrent task exits before EAS can consume another build number
  or remove provisioning profiles that the active Xcode archive still needs.
- The wrapper unsets `GOOGLE_MAPS_IOS_KEY`, runs the local production EAS build,
  submits the single generated IPA, and uses an exit trap to remove the
  worktree, `node_modules`, IPA, and scratch directory on success, failure, or
  cancellation. It exits nonzero if cleanup leaves any residue.
- Before reporting the release complete, verify `git worktree list --porcelain`
  has no temporary release worktree, `/private/tmp` contains no
  `napkin-testflight.*` scratch directory, and the home directory contains no
  `napkin-build-*` directory. Cleanup is part of the release, not an optional
  follow-up.
- Once the merged build is submitted, remove the task's now-clean, merged
  implementation worktree and run `git worktree prune --expire now`. Do not
  touch dirty, unmerged, primary-checkout, or still-active worktrees.
- `--local` because EAS cloud quota runs out; local needs Xcode + the
  distribution cert EAS manages (`eas credentials` if it ever complains).
- Export compliance never prompts: `ITSAppUsesNonExemptEncryption=false` is in
  the plist.
- Then ASC → your app → **App Store** tab → version → add the build.

## 3. ASC one-time checklist (founder, ~45 min total)

1. **App Information** — Name `Napkin — restaurant journal` (30ch), subtitle
   `save spots · remember meals`. Primary category **Food & Drink**, secondary
   **Social Networking**. Content rights: yes, the app displays third-party
   content (Google Places data/photos, used under its terms with attribution).
2. **Pricing & Availability** — Free, no IAP in v1, all territories (trim if
   you care).
3. **App Privacy** — follow §4 below (supersedes the pre-Sentry table in
   `.kanban/ASC-APP-PRIVACY.md`). Privacy Policy URL:
   `https://napkin-legal.vercel.app/privacy.html`.
4. **Age rating questionnaire** — UGC: yes; moderation: yes; report mechanism:
   yes; block mechanism: yes (all four shipped — reviewers look for exactly
   these). Expect the 13+ band. Not a Kids app.
5. **Version page** — description + promo text + keywords: paste-ready ASO
   pack in `.kanban/LAUNCH-RUNBOOK.md`. **Open the description with the origin
   story** — it's the brand: *"Napkin started on an actual napkin — three
   friends at dinner, trying to remember and rank every restaurant they'd
   ever been to together."* Keyword hygiene: never include competitor names
   (no "beli") — metadata rejections are real. Support URL:
   `https://napkin-legal.vercel.app/support.html`.
6. **Screenshots** — iPhone-only, so ONE size set: 6.9″ portrait
   **1320×2868** (ASC also accepts 1290×2796). First 3 sell it — captions from
   the ASO pack: ① wishlist/import "Save every spot you see on TikTok"
   ② restaurant page "Your taste, not strangers' stars" ③ The Poster
   "Remember every meal" ④ Table masthead ⑤ map ⑥ origin closer — "it
   started on a napkin" (the handwritten-napkin slide; if the original
   napkin still exists, photograph it and swap it in). No iPad set needed.
   **Designed artboards live at [`wireframes/store-screenshots.html`](../wireframes/store-screenshots.html)**
   (rec'd-style composites in Heirloom language) — open in Chrome, drop real
   captures into the device slots, export each board via DevTools → "Capture
   node screenshot" = exact 1320×2868 PNGs.
7. **App Review Information** — demo account
   `jackyieong+applereview@mainrichinternational.com` (run
   `scripts/seed/demo-accounts.ts`; password goes ONLY into ASC, never git).
   Paste the reviewer notes verbatim from `.kanban/APP-REVIEW-NOTES.md` — they
   pre-answer the video-import, UGC, deletion, and location questions.
   Optional but disarming: attach a screen recording of one TikTok import
   end-to-end.
8. **Release options** — **Manual release** for v1. Turn on **Phased Release**
   for every update after (7-day staged rollout to auto-updaters, pausable).
9. **TestFlight public link** — ASC → TestFlight → Public Link, then paste
   into `napkin-app/constants/links.ts` (powers the table-invite share sheet).

## 4. App Privacy labels — 2026-07-10 revision (Sentry is now LIVE)

`eas.json` now carries a real `EXPO_PUBLIC_SENTRY_DSN` in all profiles and
`lib/sentry.ts` initializes it → the old "no crash SDK, don't declare
Diagnostics" answer is **stale**. Declare:

| ASC category → type | What it is | Purposes | Linked? | Tracking? |
|---|---|---|---|---|
| Contact Info → Email Address | Account email (Supabase Auth, incl. Apple private-relay) | App Functionality | **Linked** | No |
| User Content → Photos or Videos | Entry photos and the mandatory new-account avatar; canonical copies are safety-checked by Google Cloud Vision before publication | App Functionality | **Linked** | No |
| User Content → Other User Content | Logs, notes, wishlist, lists, Tables, comments, reactions, display name | App Functionality | **Linked** | No |
| Identifiers → User ID | Supabase account id | App Functionality, Analytics | **Linked** | No |
| Usage Data → Product Interaction | First-party events in our own DB | Analytics | **Linked** | No |
| **Diagnostics → Crash Data** | Sentry (`sendDefaultPii:false`, no `setUser`, random install id) | App Functionality | **NOT linked** | No |
| **Diagnostics → Performance Data** | Sentry session health | App Functionality | **NOT linked** | No |
| **Diagnostics → Other Diagnostic Data** | Sentry breadcrumbs/session data | App Functionality | **NOT linked** | No |

Declaring all three Diagnostics types matches the privacy manifest the
`@sentry/react-native` SDK bundles — labels must not contradict SDK manifests
(Apple cross-checks). Everything else in `.kanban/ASC-APP-PRIVACY.md` still
holds: **no tracking, no ATT prompt**, and location / search history /
contacts / device ID stay **undeclared** (foreground round-trip only, nothing
retained — the reasoning table in that doc is the answer if App Review asks).

**TICKET-196 processor assessment (2026-07-16):** the existing Photos or
Videos declaration remains the right data type, purpose, linkage, and tracking
answer. The moderation call is App Functionality/security, not a new data type.
The privacy policy and review notes must name **Google Cloud Vision SafeSearch**:
the canonical JPEG is sent for an online response; Google documents that online
image bytes are processed in memory rather than persisted to disk, are not used
to train Cloud Vision, and are not shared publicly or with another third party.

## 5. Rejection-risk map (what a reviewer may flag → your answer)

| Guideline | Risk | Your answer (all shipped) |
|---|---|---|
| 1.2 UGC | Social app without safety rails | Mandatory new-account avatar + every published user image passes Google Cloud Vision SafeSearch; Report + Block remain available on every review/profile ⋯ menu; blocked-users screen; 24h human-review policy in Terms |
| 5.1.1(v) | Account deletion missing | Settings → bottom → delete, double-confirmed; the account freezes and signs out immediately while durable storage cleanup retries to completion |
| 4.8 | Offers Google sign-in without Apple | Sign in with Apple shipped (TICKET-110) |
| 2.1 | Demo account looks empty / reviewer can't see social surface | Seeder pre-populates journal + wishlist + a Table with a second user + comments |
| 5.1.1 | Permission strings vs behavior | Location foreground-only; speech recognition string explains on-device video import; photo picker is images-only (no mic string) |
| 5.2 / IP | "You import from TikTok/Instagram?" | On-device OCR/transcription of a video the user chose; nothing uploaded, stored, or redistributed; only extracted text hits our server. The reviewer notes spell this out — the demo video helps |
| 2.3 metadata | Keyword stuffing / competitor names | Keep the ASO keyword field as written |

First iOS submissions eat one rejection more often than not. If it happens:
reply in Resolution Center with the specific answer (usually already in the
reviewer notes) rather than resubmitting blind — replies get re-reviewed in
~24h.

## 6. After approval

- Release manually when you choose; updates ride phased release.
- Watch: Sentry (now live), `scripts/metrics.sql` weekly loop numbers,
  prod-deploy smoke stays green.
- Rating prompt after 3rd log (planned) — featured apps hold 4.0+.
- Each release after 1.0.0: bump `version` in `app.config.ts`, build number
  auto-increments, write What's New, phased release on.
- Membership housekeeping: Apple Developer Program renews at $99/yr — lapse =
  app pulled.
