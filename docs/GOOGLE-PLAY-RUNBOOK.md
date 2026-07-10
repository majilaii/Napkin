# Google Play Runbook — Napkin (Android)

> Written 2026-07-10. Napkin has never shipped Android — this doc is both the
> Play Console process AND the honest engineering-gap list. Read §0 before
> promising anyone an Android build.

## 0. Reality check — the app is iOS-only today

`napkin-app/` has no `android/` prebuild, zero Android QA hours, and several
iOS-native features. Gaps, in dependency order:

| # | Gap | Severity | Fix |
|---|---|---|---|
| 1 | **`android.package` is not set** in `app.config.ts` | Blocks any build | Pick one and set it. It's **permanent** once published and hyphens are illegal, so the iOS bundle id can't be mirrored — use `com.majilaii.napkin` (recommended) or `com.majilaii.diningjournalapp` |
| 2 | **Share-sheet capture doesn't exist** — `targets/share` is an iOS extension (`@bacons/apple-targets`) | The TikTok/IG/Maps capture wedge — the core loop — is missing | Android intent filters (`ACTION_SEND` text/url) + route into the same staging flow (e.g. `expo-share-intent`); moderate, self-contained |
| 3 | **Video import OCR** — `modules/media-extract` is Swift (Apple Vision + Speech), no Android source | Feature absent | v1: `Platform.OS` gate the entire import-from-video path (audit every import site so it hides, not crashes). Later: ML Kit text recognition port |
| 4 | **Maps are blank** — `android.config.googleMaps.apiKey: ''` (known issue) | Map surfaces useless | Either a real Maps SDK for Android key (native mobile SDK usage is $0 — restrict the key to the package + SHA-1) or flip `MAP_TILE_MODE` to the dormant MapTiler cream tiles (`lib/maptiler.ts`) which need no Google key |
| 5 | **Google Sign-In has no Android OAuth client** | Auth option missing | Google Cloud console → Android client with package name + SHA-1. Trap: you need TWO SHA-1s — the EAS upload key AND the Play App Signing key (Play re-signs; grab its SHA-1 from Play Console → App signing) |
| 6 | **Sign in with Apple** — `expo-apple-authentication` is iOS-only | Button would crash/no-op | Hide on Android (`Platform.OS`); email+password & Google suffice. (Apple-on-Android via Supabase web OAuth is possible later) |
| 7 | **react-native-maps 1.20.1 + New Arch untested on Android** — the patch-package fixes are iOS files (`AIRMap.m`) | Unknown stability | Device QA pass; patch Android side if the same New-Arch crash class appears |
| 8 | Invite links `/j/<code>` open the browser, not the app | Friction, not breakage | The proxy page's `napkin://` link works meanwhile; proper fix = `intentFilters` + `assetlinks.json` (App Links) on the vercel domain |
| 9 | Local notifications use default icon/channel | Cosmetic | Add a monochrome small icon + channel name before launch |

Already in place ✓: adaptive icons (foreground/background/monochrome assets
exist), `edgeToEdgeEnabled`, foreground-only location permissions declared,
`versionCode` auto-increments (`appVersionSource: remote`), Expo SDK 54
(RN 0.81) **targets API 36** — clears today's Play floor (API 35) and the
Aug 31, 2026 one (API 36).

**Estimate:** ~1–2 focused weeks of engineering + a real test device before a
credible closed test. None of it is hard; all of it is untested surface.

## 1. Account strategy — the 12-testers rule decides it

- **Personal account**: $25 one-time, BUT accounts created after Nov 13, 2023
  must run a **closed test with ≥12 opted-in testers for 14 consecutive days**
  and then apply for production access. Testers must actually install and use
  it; dropping below 12 can reset the clock. This is the long pole.
- **Organization account** (Mainrich International): needs a **D-U-N-S
  number** + org verification (days–weeks), **exempt from the 12×14
  requirement**, and the listing shows the company. **Recommended** — you have
  a company, and the friend-test crew doubles as testers anyway if you ever
  fall back to personal.
- Either way, **register now**: verification latency is real, the $25/DUNS
  paperwork is independent of code readiness, and the closed-test clock (if
  personal) only starts once a build is up.

## 2. Play Console one-time setup

1. [play.google.com/console](https://play.google.com/console) → create the
   developer account → identity/org verification.
2. **Create app**: Napkin · App (not game) · Free. Free is **irreversible**
   (fine — Napkin is free forever, Pro comes via IAP later).
3. **Play App Signing** (default): Google holds the signing key; EAS generates
   and stores the upload keystore automatically on first build
   (`eas credentials -p android` to inspect).
4. **Policy → App content** declarations:
   - Privacy policy: `https://napkin-legal.vercel.app/privacy.html`
   - Ads: **No** (no ads, ever)
   - Content rating (IARC questionnaire): UGC **yes**, with moderation +
     report + block. Expect a Teen-ish rating from the UGC answers.
   - Target audience: **13+** (never select children — avoids Families policy)
   - Data safety: §3 below
   - News app / COVID / government / financial / health: all No
5. **Account deletion — the one real gap**: Play requires in-app deletion
   (✓ shipped) **AND a web URL** where users can request deletion without
   reinstalling. `web/legal/` has privacy/support/terms but **no
   `delete-account.html`** → add a small static page to napkin-legal.vercel.app
   (steps: in-app path, or email `support@…` from the account address) and put
   the URL in the Data safety form. **TODO before submission.**
6. **App access**: supply the demo login
   (`jackyieong+applereview@mainrichinternational.com` + password, same seeded
   account as Apple) — Play reviewers must be able to get past auth.

## 3. Data safety form (Play's nutrition label)

Same facts as the ASC labels (see `docs/APP-STORE-RUNBOOK.md` §4), Play
vocabulary. "Shared" means transferred to third parties for THEIR purposes —
Supabase/Google Places/Anthropic are service providers, so **nothing is
"shared"**, nothing is sold, no ads.

| Play category | Collected? | Linked/required | Notes |
|---|---|---|---|
| Personal info → Email address | Yes | Required, account | Supabase Auth (incl. Google/Apple sign-in emails) |
| Personal info → User IDs | Yes | Required | Supabase account id |
| Photos and videos → Photos | Yes | Optional | Entry photos, avatar |
| App activity → Other user-generated content | Yes | Optional | Logs, notes, lists, Tables, comments |
| App activity → App interactions | Yes | Analytics | First-party events, own DB, no third-party SDK |
| App info & performance → Crash logs + Diagnostics | Yes | Not linked to identity | Sentry, `sendDefaultPii:false`, no ads/analytics SDK |
| Location | **No** | — | Ephemeral: coordinates serve the request in real time and are never stored — Play's ephemeral-processing carve-out, same reasoning as the ASC doc |

Cross-cutting answers: encrypted in transit **yes**; user-requestable deletion
**yes** (in-app + the §2.5 web link); data collection optional vs required —
email/user id required, the rest optional.

## 4. Store listing assets

| Asset | Spec | Note |
|---|---|---|
| App icon | 512×512 PNG | Export from the iOS icon master |
| Feature graphic | 1024×500 | **Required.** Warm-paper wordmark treatment; shows atop the listing |
| Phone screenshots | 2–8, portrait 1080×1920+ | Reuse the iOS screenshot art re-framed in Android device chrome; same first-3 captions as the ASO pack |
| Title | ≤30ch | `Napkin — restaurant journal` |
| Short description | ≤80ch | `Save spots from TikTok, Maps & friends. Remember every meal.` |
| Full description | ≤4000ch | Expand the ASO promo text (`.kanban/LAUNCH-RUNBOOK.md`); Play full descriptions are keyword-indexed, so write naturally but include save/wishlist/journal/restaurant terms |
| Category | Food & Drink | Contact email + website required (use napkin-legal support page) |

## 5. Build & submit with EAS

```bash
# after android.package is set in app.config.ts
cd napkin-app

# Cloud build (simplest; local -p android needs JDK 17 + Android SDK/NDK):
npx eas build --platform android --profile production        # produces .aab
# Local fallback when cloud quota is gone:
npx eas build --platform android --profile production --local

# FIRST upload must be manual: Play Console → Testing → Internal testing →
# create release → upload the .aab. (The Play API cannot create the app or
# its first artifact, so `eas submit` only works from the second build on.)

# From build #2 on:
npx eas submit --platform android --path ./app-*.aab
```

`eas submit -p android` needs a **Google service account**: Play Console →
Setup → API access → link a Google Cloud project → create a service account
with the "Release manager" role → download the JSON key → point
`submit.production.android.serviceAccountKeyPath` at it in `eas.json` (keep
the JSON out of git). Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` env parity for
sign-in, and remember the two-SHA-1 OAuth trap (§0.5).

## 6. Testing tracks → production

1. **Internal testing** — up to 100 emails, live in minutes, no review. Your
   own devices + partner.
2. **Closed testing** — the friend crew. If the account is personal, this is
   where the **12 testers × 14 days** clock runs; then apply for production
   from the dashboard. Google also checks the test was real (usage, feedback,
   iteration) — shipping a build or two during the window helps.
3. **Pre-launch report** — automatic device-lab crawl on every uploaded AAB;
   read it, it's free crash coverage across real hardware.
4. **Production** — staged rollout: start 10–20%, watch Sentry + Play vitals
   (ANR/crash rates gate visibility), ramp to 100%. First reviews on a new
   account can take up to ~7 days; afterwards usually hours–days.

## 7. Suggested sequence (iOS-first GTM stays intact)

1. **Now (cheap, no code):** register the Play account (org/D-U-N-S path),
   add `delete-account.html` to the legal site, decide `android.package`.
2. **After the iOS public launch settles:** the §0 engineering pass
   (package → share-intent → maps tiles → auth guards), one borrowed/cheap
   Pixel for QA.
3. **Closed test** with the existing friend crew; fix what the pre-launch
   report and testers surface.
4. **Production** with staged rollout — after the GTM gate, same as iOS.

Reference: [12-tester/14-day requirement](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en) ·
[target API policy](https://support.google.com/googleplay/android-developer/answer/11926878?hl=en)
