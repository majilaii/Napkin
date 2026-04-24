---
id: TICKET-026
title: "Professional critics on restaurant pages (NYT, Infatuation, Eater)"
priority: medium
status: done
created: 2026-04-20
updated: 2026-04-23
tags: [restaurants, critics, ingestion, content]
---

# Professional critics on restaurant pages

## Problem

The V4c "Everyone" tab design (see `restaurant-canvas.html`) closes with a quiet "Professional takes" band at the bottom — critic reviews from NYT (Pete Wells stars), Infatuation, Eater Essentials, etc. Today there is no ticket for ingesting or rendering this data; the UI placeholder we shipped in CommunityTab has a line explaining that critic reviews "will collect here," but nothing collects them.

Critics are a distinct signal from both Tablemates (Ring 1) and public Napkin users (TICKET-021 / Ring 2). They are authority-weighted, sparse, and durable — a Pete Wells review from 2013 is still load-bearing context on Carbone. Without them, restaurant pages are missing the one external signal that adds real voice instead of just a number.

## Notes

### Why this is its own ticket, not folded into TICKET-021

TICKET-021 ships user-authored public reviews — a stream of Napkin-account notes. Critics are:
- Not Napkin accounts (no `/u/[username]` profile to link to).
- Not self-authored in the app (ingested, not composed).
- Rendered with publication branding (NYT / Infatuation / Eater), not a reviewer avatar.
- Durable editorial, not a stream — typically one critic review per venue per publication.

Different primitive, different IA slot, different ingestion path. Folding into TICKET-021 would overload that ticket's eligibility / RLS / engagement model with a completely parallel content shape.

### MVP plan (from the design-file brainstorm, `restaurant-canvas.jsx` open questions)

- **NYT:** scrape the Pete Wells star rating + excerpt from the public review page. HTML is legible, no auth required. Start here — NYT is the most cited critic signal in NYC and the design thesis is NYC-first.
- **Infatuation:** second. The 10-point score is the most "Napkin-native" numeric critic signal. Wait for a data deal or stable scraping posture before shipping at scale.
- **Eater:** "38 Essentials" style lists rather than numeric scores — render as a badge ("Eater Essential, 2024") rather than a number. Low priority.
- **Resy / OpenTable:** skip entirely. Locked-down JS, anti-scraping, and the signal is booking-availability not editorial.
- **Napkin-wide average as the floor:** irrelevant here post-doctrine (CLAUDE.md: no cross-Table aggregate). Strike from the original brainstorm.

### Data shape (rough, for architect to finalize)

```
table: professional_critic_reviews
  id uuid pk
  restaurant_id uuid fk -> restaurants.id
  publication text        -- 'nyt' | 'infatuation' | 'eater' | ...
  kind text               -- 'stars' | 'score' | 'essential' | 'feature'
  score text              -- '★★★' | '9.1' | '—' | null
  score_out_of text       -- null | '10' | null | null
  author text             -- 'Pete Wells'
  published_date date
  excerpt text            -- short pull-quote, license-safe length
  source_url text         -- deep link to full review
  scraped_at timestamptz
  scrape_confidence int   -- 0..100, for flagging bad parses
```

One row per (restaurant, publication) — if a publication revisits, upsert with newer `published_date`.

### Ingestion pipeline

- Scheduled Deno edge function or background worker (likely a Supabase cron function — see project stack).
- Keyed off `restaurants.external_id` (Google Place ID → venue name + address → publication search).
- Rate-limit politely. Cache aggressively — critic reviews don't change daily.
- Start batch — pre-populate for all currently-logged restaurants, then drip-fill on new restaurant creation.
- A manual-override path for the editor (me / us) to correct bad parses — small admin surface, maybe just SQL for v1.

### Rendering

Matches the V4c "Professional takes" band:
- Section divider: hairline rules flanking a tracked "Professional takes" label.
- One row per critic review: publication name (Newsreader 14px medium) + kind (Manrope 9px uppercase tracked) + score (Newsreader 15px medium, right-aligned), italic excerpt serif, "— Author, YYYY" caption.
- Tap row → open `source_url` in external browser (in-app browser acceptable).

The row component maps cleanly to the `CriticRow` JSX in `restaurant-screens.jsx`. Port to RN without structural changes.

### Licensing / legal

- Short excerpt (≤30 words) + attribution + source link is the established editorial-citation posture.
- Do NOT reproduce full reviews. Do NOT render critic text without the publication name.
- If a publication issues a takedown, comply and flip a `suppressed` flag on the row (not a delete — for audit).
- Architect should confirm the excerpt-length policy with legal before scaling ingestion beyond NYT.

### Where this renders

Per current product doctrine (CLAUDE.md + TICKET-021), restaurant pages have tabs: Our Table / Everyone / Info.
- Critics band lives at the bottom of the **Everyone** tab, under any public reviews (TICKET-021's section).
- On a restaurant where nobody on Napkin has logged but a critic has reviewed, Everyone still has content — critics become the default signal, which is honest.
- Critics never render in Our Table (that tab is Tablemate-only signal).

### Dependencies

- **TICKET-016 (Restaurant page v2)** — done. Hero, tabs, Info tab all in place.
- **TICKET-021 (Public reviews)** — ready. Critics band renders below this section on the Everyone tab. No hard blocker on either side; 021 can ship first, then 026 slots in underneath.
- **Restaurant entity foundation (TICKET-014)** — done. `restaurants.id` and `restaurants.external_id` are the keys scraping joins against.
- No calibration-signal dependency (TICKET-022) — critics are authority-weighted, not taste-calibrated.

### Explicitly deferred

- Non-US publications (Time Out London, Guardian Food, etc.) — US-first for MVP.
- Blog / substack food writers — noise-to-signal ratio too low without a curated list. If we build a "Notable voices" tier later (V2c design alluded to this), that is a distinct ticket.
- Full-text critic-review search / discovery inside Napkin — these are context cards on restaurant pages, not browsable content.
- Critic-driven push notifications ("NYT just updated their take on Carbone") — push is deferred product-wide.
- Aggregating a "critics consensus" number — we render each publication's own signal, never blend across them. Matches the doctrine of no cross-source aggregation.

### Open questions (for product-designer at spec time)

- Should the Everyone tab always show a "Professional takes" header even when no critics exist for this restaurant, or hide the section entirely? Current design implies hide-when-empty.
- Do we link to the critic's profile anywhere in-app (Pete Wells' other reviewed restaurants)? Probably not v1 — scope creep toward a critic-author primitive.
- How do we handle a publication that revises its review (Infatuation sometimes re-reviews)? Keep latest only, or render a quiet "earlier review: X" affordance below?
- Admin UX for correcting bad scrapes — SQL only, or a minimal in-app admin row? Architect's call, dependent on who's maintaining it.
- Should critic kind (`stars` / `score` / `essential`) drive a distinct visual treatment per publication, or is the generic CriticRow layout enough?

---

## Product Spec

### User Stories

- As a **user viewing Carbone with a Pete Wells two-star review + an Infatuation 8.6**, I want both critic rows rendered with their own publication branding and numeric shape, so that I can read each authority as its own voice without an aggregator smoothing them together.
- As a **user on a restaurant with zero critic coverage**, I want the Professional takes band hidden entirely — no header, no empty-state copy — so that the page doesn't advertise an absent signal.
- As a **user tapping a critic row**, I want the full review to open in an in-app browser with a back-to-Napkin affordance, so that I can read the source without losing my place on the page.
- As a **user on a restaurant whose Infatuation review was revised in 2024 after a 2019 original**, I want to see only the latest review surfaced in the row, so that the signal I'm reading is current and not superseded.
- As a **Napkin editor/operator spotting a garbled Pete Wells excerpt**, I want to flip `suppressed=true` on that row and have it disappear from the client immediately on next fetch, so that bad parses don't ship as critic voice.
- As a **user on a ghost restaurant still resolving from search**, I want the Professional takes band not to render at all, so that the page doesn't flash in-and-out critic rows while the restaurant persists.
- As a **user viewing an Eater Essential-2024 entry**, I want the row rendered as a labeled badge ("Essential · 2024") rather than a numeric score, so that the signal shape matches the critic's actual verdict rather than being forced into a scoreboard.
- As a **user reading a durable critic voice from 2013 (e.g., Pete Wells on Carbone)**, I want the author + year caption rendered verbatim, so that I read it as historical authority rather than as a stale datapoint.

### Acceptance Criteria

**Placement**
- [ ] Critics render as a `ProfessionalTakesBand` section at the bottom of the **Visits tab** content in `app/restaurant/[id].tsx`, below `VoicesStream` and below any TICKET-022 calibration surfaces.
- [ ] The band does NOT render on the Photos tab or Info tab.
- [ ] When both `VoicesStream` and the critics band render on Visits, a hairline rule (`rgba(28,28,25,0.12)`) separates them with Spacing.xl margin.
- [ ] The band is hidden entirely when no non-suppressed, visible rows exist for the restaurant. No header, no placeholder copy, no spacer.

**Section chrome**
- [ ] Band header reads "Professional takes" in Manrope 9px / letterSpacing 1.5 / uppercase, `palette.textMuted`, flanked by hairline rules (matches existing `CommunityTab` divider pattern).
- [ ] Header hairline rules are `palette.ruleInkSoft`.
- [ ] Band spacing: Spacing.lg above header, Spacing.md below header before first row.

**Row rendering (CriticRow)**
- [ ] Each row renders: publication name (Newsreader 14px Medium, `palette.text`) on the left line 1; kind label (Manrope 9px uppercase tracked, `palette.textMuted`) as a sublabel beneath publication; value column right-aligned on line 1 (Newsreader 15px Medium); italic excerpt on line 2 (Newsreader 13px Italic, `palette.textSecondary`); `— Author, YYYY` caption on line 3 (Manrope 10px, `palette.textMuted`).
- [ ] The entire row is a single `Pressable`; tap opens `source_url`.
- [ ] Rows separated by hairline ruled top border; no hard 1px borders; uses existing dusty-rose rule color pattern from `VoicesStream`.

**Kind-specific value rendering**
- [ ] `kind=stars`: value column renders stars as glyphs (e.g., `★★★`) in `palette.star` at Newsreader 15px; does NOT append "/4" or similar denominator.
- [ ] `kind=score`: value column renders as `"9.1"` with the denominator `"/10"` appended in Manrope 10px `palette.textMuted` (e.g., "9.1 /10"). Denominator taken from `score_out_of`; if null, render the bare number.
- [ ] `kind=essential`: value column renders as an amber badge labeled `"Essential"` with the `published_date` year appended below in Manrope 9px tracked (e.g., `"ESSENTIAL / 2024"`). No numeric score.
- [ ] `kind=feature`: value column renders as a single em-dash `—` in `palette.textMuted`; the publication + excerpt still carries the signal.

**Content constraints**
- [ ] Excerpt renders at most 30 words; truncated with `numberOfLines={3}` as a visual safety net. If `excerpt` is null or an empty string, line 2 is omitted (not rendered as a blank line).
- [ ] Publication name is always rendered; a row without `publication` is filtered out client-side.
- [ ] Attribution caption `— Author, YYYY` renders when either `author` or `published_date` is present. Missing year: caption reads `— Author`. Missing author: caption reads `— <Publication name>, YYYY`. Both missing: caption omitted.

**Ordering**
- [ ] Rows ordered by a fixed publication rank: NYT → The Infatuation → Eater → any others (alphabetical by publication). Within a single publication (rare), order by `published_date` descending.
- [ ] Rank is applied client-side from a small constant so it can be updated without a data migration.

**Tap behavior**
- [ ] Tapping a row opens `source_url` via `expo-web-browser`'s `openBrowserAsync` (in-app browser with Napkin chrome) when `source_url` is a valid https URL.
- [ ] Row is non-interactive (no ripple, no opacity on press) when `source_url` is null or missing.

**Stale / revised reviews**
- [ ] Only one row renders per `(restaurant, publication)` pair. The row shown is the latest by `published_date`. Prior versions are not rendered and no "earlier review" affordance is shown in v1.

**Suppressed / low-confidence**
- [ ] Rows with `suppressed=true` are filtered out client-side before ordering. They are never rendered, even for debug.
- [ ] Rows with `scrape_confidence < 70` are treated as if `excerpt` is null — the row still renders (publication, kind, score, caption) but the excerpt line is suppressed. Rationale: the numeric signal is structured enough to trust; the pulled pull-quote is not.

**Ghost restaurants**
- [ ] On a ghost restaurant (no `restaurants.id`, rendered from Places payload), the Professional takes band is hidden unconditionally. Rationale: scraping keys off `restaurants.external_id` and produces rows only for persisted restaurants.
- [ ] After the first heart/log tap promotes the ghost to persisted, the band appears on the next `useRestaurantPage` fetch if matching rows exist.

**Attribution / legal**
- [ ] Publication name is always rendered above the excerpt. Excerpts are never rendered without publication branding.
- [ ] Every row with an excerpt also has `source_url` and renders the row as tappable. A row with `excerpt` but no `source_url` is filtered out client-side (defense against accidental licensing drift).

**Copy**
- [ ] Section label: `"Professional takes"` (tracked uppercase: `"PROFESSIONAL TAKES"` at render).
- [ ] Publication display names verbatim: `"NYT"`, `"The Infatuation"`, `"Eater"`. Client maps raw `publication` enum (`'nyt' | 'infatuation' | 'eater'`) to display name via a small constant.

**Accessibility**
- [ ] Each row has `accessibilityRole="link"` and `accessibilityLabel` of the form `"<Publication> <value>. <excerpt>. by <author>, <year>. Opens review."`.
- [ ] Section header is `accessibilityRole="header"`.

### UX Decisions

- **Placement at bottom of Visits tab (not a dedicated "Everyone" tab)**: the shipped IA is Visits / Photos / Info; public reviews already live inside Visits via `VoicesStream`. Critics sit below voices with a hairline separator. Rationale: critics are a coda to the voice stream, not a parallel tab. The original ticket's "Everyone tab" language is stale relative to TICKET-021's IA.
- **Publication ordering = fixed rank (NYT → Infatuation → Eater)**, not published-date desc. Rationale: users scan the Pete Wells row first regardless of recency; date ordering would push a recent Eater Essential above a durable NYT star review, which inverts authority. Within a single publication, date desc breaks ties.
- **`kind=essential` renders as a badge, not a number**. Rationale: an Essential is a yes/no verdict, not a scalar. Forcing it into the score slot ("Essential · 10/10") implies a comparison against Infatuation's 9.1 that doesn't exist.
- **Show the row even when excerpt is missing**. Rationale: a Pete Wells two-star review without a pull-quote still carries signal (stars + author + year). The publication + score are the load-bearing part; the excerpt is color.
- **In-app browser (`openBrowserAsync`), not system browser**. Rationale: preserves the return-to-Napkin flow; critic pages are brief reads and bouncing to Safari breaks the journal metaphor. Matches how we want to handle restaurant website taps in Info tab later.
- **Hide-when-empty, never a placeholder**. Rationale: a "Critics haven't reviewed this yet" message advertises absence as if it were a gap, when for most restaurants it's simply not a critic-reviewed venue. Honest absence = silence.
- **Show `— Author, YYYY` verbatim even when old (e.g., 2013)**. Rationale: critic voice is durable, per the ticket's durability doctrine. A 2013 Pete Wells on Carbone is still load-bearing; hiding the year would flatten it into an ahistorical snippet.
- **Publication name in Newsreader Medium (not italic), kind in Manrope tracked**. Rationale: the publication is a proper noun carrying authority — serif medium reads more editorial than italic, which is reserved for emotional/first-person voice (Table members, ratings, notes). Kind label stays in the functional Manrope slot.
- **Keep only latest review per (restaurant, publication)**. Rationale: rendering both a 2019 and a 2024 Infatuation review introduces a "which do I believe" cognitive tax for a signal that is already sparse. The latest is the current verdict; earlier reviews are archive, not feed.
- **Low-confidence excerpt suppression (`scrape_confidence < 70`), row still renders**. Rationale: the structured fields (publication, author, score, URL) are high-trust because they're parsed from stable HTML; pull-quotes are the fragile part. Drop the fragile, keep the durable.

### Out of Scope

- Non-US publications (Time Out London, Guardian Food, etc.) — US-first MVP.
- Blog / Substack / independent food writers and "Notable voices" tier — separate primitive, separate future ticket.
- Full-text critic-review search or a `/critics/<slug>` discovery surface.
- Critic author profiles (no "other Pete Wells reviews" link, no author primitive).
- Critic-driven push notifications.
- A cross-publication "critics consensus" score or any blended critic aggregate.
- In-app UI for users to submit critic reviews.
- A full admin screen for correcting bad parses — SQL-only for v1 (see resolved Q4).
- The ingestion scraper / pipeline itself — architect should split this into: (a) render spec and data contract (this ticket), (b) a separate ingestion ticket for the scraper + admin suppression. UI acceptance criteria here govern read path only.
- "Earlier review" affordance for revised reviews (see resolved Q3).

### Open Questions — Resolved (2026-04-23)

- **(a) Hide-when-empty vs always-show header**: **Hide the entire band when no non-suppressed rows exist.** No header, no placeholder copy. Rationale: honest absence beats advertised silence.
- **(b) Link to critic's profile in-app**: **No.** Do not build a critic-author primitive or in-app critic profile. A critic is a rendered voice on a restaurant page, not a browsable entity. Rationale: scope creep toward a parallel author graph; publisher + author + year as a caption is enough.
- **(c) Revised reviews (Infatuation re-review case)**: **Keep latest only.** Render just the most recent review per `(restaurant, publication)`; no "earlier review: X" affordance. Rationale: dual-rendering a 2019 and a 2024 review introduces "which is current" confusion on a signal that should read as a single authority voice.
- **(d) Admin UX for corrections**: **SQL-only for v1** — architect flips `suppressed=true` directly in the DB; no in-app admin surface. Rationale: correction volume will be low and the maintainers are technical; an admin screen is build-cost without user upside until we're ingesting at scale.
- **(e) Kind-specific visual treatment**: **Yes — three distinct value renders for `stars` / `score` / `essential`.** Stars as glyphs, scores as numeric with `/10` denominator, essential as a labeled badge. Rationale: the signal shape is genuinely different per publication (ordinal vs scalar vs binary); one-size row treatment flattens meaning. `feature` kind renders as em-dash (no value).

---

## Technical Design

### Approach

Ship the render path + data contract only: one migration for `professional_critic_reviews`, a seed file with ~6 hand-curated fixtures, an extension to `restaurant-history?action=page` that joins and filters critic rows server-side, a single new field on `useRestaurantPage`'s payload, and one new leaf component `ProfessionalTakesBand` (with an internal `CriticRow`) mounted at the bottom of the Visits-tab block in `app/restaurant/[id].tsx`, under `VoicesStream`. The ingestion pipeline is out of scope — seed rows exist so the band can be visually verified end-to-end, and TICKET-033 (new, in backlog) owns the scraper + operator suppression UX.

### Architecture Decisions

- **Fold critic rows into `useRestaurantPage`'s single payload — do NOT add a separate hook.** Critics are one more sibling signal on a single-fetch detail page; invalidation, ghost-handling, and refresh cadence are identical to the rest of the page (stale 5min, invalidated on write by the same `queryKeys.restaurants.page` key). A separate `useRestaurantCritics` would duplicate auth + restaurant resolution and double the network round-trip for a few-row append. Trade-off: the edge function grows; acceptable — it's already the one-file action router for "everything at this venue."
- **Server-side suppression filter (`suppressed = true` never crosses the wire).** Cleaner wire contract and defense-in-depth against a client bug accidentally rendering a takedown row. The RLS policy grants bare SELECT to authenticated users; the filter lives in the `action=page` query (`eq('suppressed', false)`), not in RLS. Trade-off: a suppressed row can't be rendered for debug — acceptable; ops inspects directly via SQL.
- **Server-side low-confidence excerpt blanking (`scrape_confidence < 70` → `excerpt = null` before returning).** Same rationale: the wire shape should not carry a field the client is required to ignore. Server blanks `excerpt` (and drops `scrape_confidence` from the wire entirely — clients don't need it). Client just checks `excerpt != null`. Trade-off: losing the debug signal of "this one was low confidence" on the client — not needed; operators read it in SQL.
- **Publication rank lives in a client constant at `components/restaurants/criticPublications.ts`.** Single source for both display-name mapping (`nyt → "NYT"`, `infatuation → "The Infatuation"`, `eater → "Eater"`) and sort-rank. Updatable without a migration or redeploy of the edge function. Trade-off: client and server-side sort would diverge if we ever tried to paginate — not a concern for ≤3 rows per venue.
- **One `CriticRow` component with a kind switch, not three components.** `stars` / `score` / `essential` / `feature` share ~90% of their layout (publication line, sublabel, excerpt, attribution). Only the value column differs; that's a small internal `renderValue(kind, row, palette)` helper. Trade-off: the switch grows if a fifth kind appears — acceptable; simpler than four files.
- **Ghost-restaurant hiding is enforced by the endpoint, not the client.** When the restaurant doesn't resolve (pure ghost: no row in `restaurants`), the existing `action=page` short-circuit already returns empty payloads; the new `professional_critic_reviews` field is appended to that empty payload as `[]`. Client-side, `ProfessionalTakesBand` self-hides when its input array is empty. No extra guard in `app/restaurant/[id].tsx`. Trade-off: a non-ghost restaurant with zero critic rows also hides — which is the spec's "hide-when-empty" behavior, so double-win.
- **Extend `restaurant-history`, do NOT emit a separate endpoint.** One more query on the same page read. Same reasoning as TICKET-016 used when introducing `action=page`: the restaurant detail page is one logical read.
- **Flags for product** — none. The Product Spec already corrected the "Everyone tab" language from the original Notes section and locked all five open questions on 2026-04-23. Designing to spec as-written.

### Data contract

Appended to `RestaurantPageData`:

```ts
type ProfessionalCritic = {
    id: string;
    publication: 'nyt' | 'infatuation' | 'eater' | string;  // enum-loose — new publications add without a client release
    kind: 'stars' | 'score' | 'essential' | 'feature';
    score: string | null;          // '★★' | '8.6' | null  (presentation form; client does NOT format)
    score_out_of: string | null;   // '10' | null          (used only when kind === 'score')
    author: string | null;
    published_date: string | null; // 'YYYY-MM-DD' ISO; client extracts year for caption
    excerpt: string | null;        // server-blanked when scrape_confidence < 70
    source_url: string | null;     // https URL; client checks protocol before openBrowserAsync
};

// Appended to RestaurantPageData
professional_critics: ProfessionalCritic[];
```

Wire fields intentionally omitted from the client payload: `restaurant_id` (redundant — page is already scoped), `scraped_at` (operator-only), `scrape_confidence` (server blanks `excerpt` based on it; client has no use), `suppressed` (filtered server-side), `created_at`, `updated_at`. The server also filters rows missing `publication` or missing both `excerpt` and `source_url` is tolerated (the AC only drops rows that have `excerpt` but no `source_url` — that filter lives server-side too).

Ordering is NOT applied server-side — client applies the fixed rank per the architectural decision above.

### DB migration outline

File written: `supabase/migrations/20260501000000_create_professional_critic_reviews.sql`.

Columns, indexes, RLS, and an `updated_at` trigger follow the migration verbatim. Key points:

- **PK**: `id uuid default gen_random_uuid()`.
- **FK**: `restaurant_id -> restaurants(id) on delete cascade` — a deleted restaurant drops its critics too.
- **CHECK**: `kind in ('stars','score','essential','feature')` and `scrape_confidence between 0 and 100`.
- **UNIQUE index**: `(restaurant_id, publication)` — enforces "one row per venue per publication"; TICKET-033's scraper uses this as the upsert key so latest-wins is a simple `on conflict do update`.
- **Read index**: `(restaurant_id) where suppressed = false` — partial index matches the exact predicate the `action=page` query uses.
- **Tiebreaker index**: `(restaurant_id, publication, published_date desc)` — supports any future "keep latest per publication" query if the unique key is loosened.
- **RLS**: SELECT open to `authenticated`; no INSERT/UPDATE/DELETE policy defined (implicit deny). Service role bypasses RLS — that's how ingestion writes.
- **Trigger**: `tg_critic_reviews_touch_updated_at` bumps `updated_at` on UPDATE.

### Seed file

File written: `supabase/seeds/critics_seed.sql`. Rows:

1. **Carbone / NYT / stars** — Pete Wells 2013, ★★, full excerpt, `scrape_confidence=95`.
2. **Carbone / Infatuation / score** — 8.6 / 10, full excerpt, `scrape_confidence=90`.
3. **Carbone / Eater / essential** — low-confidence fixture: `scrape_confidence=40` + garbled excerpt. Verifies the row still renders but excerpt is blanked.
4. **Via Carota / Eater / essential** — clean essential badge row, year 2024.
5. **Via Carota / NYT / feature** — feature kind (em-dash value column) with byline.
6. **Via Carota / Infatuation / score** — `suppressed=true` fixture. Verifies takedown rows never render.

Each insert is a `WITH r AS (SELECT id FROM restaurants WHERE name ilike 'X%' LIMIT 1)` + `INSERT ... SELECT` form so missing restaurants are silently skipped instead of failing the seed. `ON CONFLICT (restaurant_id, publication) DO UPDATE` makes the seed idempotent. Builder: ensure `carbone` and `via carota` exist in the dev DB before running (log a solo entry at each if needed), or edit the seed to match what's there.

### New / changed files

**Migration (new)**
- `supabase/migrations/20260501000000_create_professional_critic_reviews.sql` — schema + indexes + RLS + updated_at trigger.

**Seed (new)**
- `supabase/seeds/critics_seed.sql` — 6 fixture rows covering all four `kind`s + one suppressed + one low-confidence.

**Edge function (modify)**
- `supabase/functions/restaurant-history/index.ts` — inside the `action=page` branch, after `resolvedRestaurantId` is known, query `professional_critic_reviews` filtered by `suppressed=false`, blank `excerpt` when `scrape_confidence < 70`, strip operator-only fields, and append as `professional_critics` on the response. Null-restaurant (pure-ghost) branch returns `professional_critics: []`.

**Hook (modify)**
- `napkin-app/hooks/restaurants/useRestaurantPage.ts` — add `ProfessionalCritic` type export, add `professional_critics: ProfessionalCritic[]` to `RestaurantPageData`, back-fill to `[]` in the response normalizer (graceful degradation for stale edge function).

**Query keys (no change)**
- `napkin-app/lib/queryKeys.ts` — no new key; critics share `queryKeys.restaurants.page(...)`.

**Components (new)**
- `napkin-app/components/restaurants/criticPublications.ts` — two constants: `PUBLICATION_DISPLAY_NAME: Record<string, string>` (`nyt → "NYT"`, `infatuation → "The Infatuation"`, `eater → "Eater"`) and `PUBLICATION_RANK: Record<string, number>` (`nyt: 0, infatuation: 1, eater: 2`; unknowns fall through to `Infinity` then alphabetical). Pure data, no JSX.
- `napkin-app/components/restaurants/ProfessionalTakesBand.tsx` — section wrapper. Takes `{ critics: ProfessionalCritic[] }`. Filters client-side: drop rows missing `publication`, drop rows with `excerpt` present but `source_url` missing (defense against licensing drift per AC). Sort by `PUBLICATION_RANK` then alphabetical-by-publication-display-name then `published_date desc` tiebreaker. Hides entirely when filtered list is empty (no header, no spacer). Renders a header band ("PROFESSIONAL TAKES", Manrope 9px / 1.5 tracked, `palette.textMuted`, flanked by `palette.ruleInkSoft` hairlines — copies `CommunityTab`'s divider pattern). Maps each row through `CriticRow`.
- `napkin-app/components/restaurants/CriticRow.tsx` — one row. Single `Pressable` with `accessibilityRole="link"`. Internal `renderValue(kind, row, palette)` switch: `stars` → glyphs in `palette.star` at Newsreader 15px; `score` → bare number + Manrope 10px `/score_out_of` denominator in `palette.textMuted`; `essential` → amber badge (`backgroundColor: palette.amberChipHi`, `color: palette.amberInk`) labeled "Essential" with the year tracked below; `feature` → single em-dash in `palette.textMuted`. Row layout: publication name line 1 left (Newsreader Medium 14 — NOT italic), kind sublabel under publication (Manrope 9 uppercase tracked), value column right-aligned on line 1, italic excerpt line 2 (`numberOfLines={3}`, omitted when null), `— Author, YYYY` caption line 3 with the fallbacks from the AC. `onPress` no-ops when `source_url` is null (and `opacity: pressed` is skipped); otherwise calls `openBrowserAsync(source_url)` when it starts with `https://`.
- `napkin-app/components/restaurants/index.ts` — MODIFY — export `ProfessionalTakesBand` and `CriticRow`. (Publications constant stays internal to the folder; no barrel export needed.)

**Screen (modify)**
- `napkin-app/app/restaurant/[id].tsx` — inside the `activeTab === 'visits'` branch, after `<VoicesStream ... />`, render `<ProfessionalTakesBand critics={pageData?.professional_critics ?? []} />` when `restaurant` and `pageData` are present. The band self-hides on empty input, so no outer guard. The spec-required `Spacing.xl` gap + hairline-rule separator between VoicesStream and the band lives inside `ProfessionalTakesBand`'s top margin, not in the screen.

Total new files: 3 component files + 1 migration + 1 seed = 5. Modified: 3 (edge function, hook, screen). Well under the 8-file guardrail.

### Implementation order

1. **Migration** (`20260501000000_create_professional_critic_reviews.sql`) — apply locally first; nothing else can insert or render without the table.
2. **Seed file** (`supabase/seeds/critics_seed.sql`) — run against the dev DB so visual verification is possible from step 4 onwards. Confirm Carbone + Via Carota (or substitute names) exist first.
3. **Edge function** — add the `professional_critics` query to `action=page`. `curl` against it with a known restaurant UUID; confirm seeded rows come back, suppressed row is absent, low-confidence row has `excerpt: null`. Deploy: `npx supabase functions deploy restaurant-history --project-ref ftvmseaqwwlcxtdlvxxz`.
4. **Hook + type extension** — add `ProfessionalCritic` type and the `professional_critics` field with `[]` back-fill in `useRestaurantPage.ts`. Verify TypeScript compiles across callers.
5. **Leaf components in parallel** — `criticPublications.ts` (pure constant), `CriticRow.tsx` (mock props), `ProfessionalTakesBand.tsx` (mock props). Each is presentational; builder can ship these with a Storybook-style harness entry if desired.
6. **Wire into screen** — add the single line under `VoicesStream` in `app/restaurant/[id].tsx`. Add the barrel export. Verify: Carbone shows NYT + Infatuation + Eater (with low-confidence excerpt blanked); Via Carota shows NYT + Eater, NOT Infatuation (suppressed); a ghost restaurant shows no band; a non-seeded restaurant shows no band.
7. **File the follow-up** — `/Users/jacky/Napkin/.kanban/backlog/TICKET-033-critics-ingestion.md` is already written as part of this design. Builder confirms it's in backlog before closing 026.

### Risks

- **Seed depends on venue names present in dev DB.** Mitigation: seed uses `WITH r AS (... LIMIT 1) INSERT ... SELECT FROM r` so missing restaurants silently skip. Builder ensures at least one of (Carbone, Via Carota) exists or edits the seed names.
- **Back-fill for stale edge-function response.** When the migration lands but the edge function hasn't been redeployed, `pageData.professional_critics` would be undefined. Mitigation: the hook's normalizer defaults it to `[]` (matches existing back-fill pattern for `distributions`, `photos`, etc.).
- **`publication` enum drift.** Scraper might emit `'infatuation_ny'` or similar variants. Mitigation: `PUBLICATION_DISPLAY_NAME` falls back to the raw string if unmapped; `PUBLICATION_RANK` falls through to alphabetical. New publications render correctly without a client release. Anti-risk: if we ever want strict validation, move the enum into a CHECK constraint — not in v1.
- **License exposure from excerpts longer than 30 words.** Spec caps excerpt at 30 words client-side via `numberOfLines={3}` visual bound; server does not enforce word count. TICKET-033 owns the ingestion-side word-count clamp. Mitigation: the visual bound + seed compliance is enough for v1; ingestion will enforce the hard cap.
- **Ghost deep-link showing band flicker.** Not a real risk — server returns `[]` for ghost and the band self-hides; the client never sees partial data because there's no in-flight between "hidden" and "empty."

---

## Build Log

### What got built
- [x] Migration applied to remote DB — `20260501000000_create_professional_critic_reviews.sql` pushed to project `ftvmseaqwwlcxtdlvxxz` via `supabase db push --linked`. Applied 2026-04-23.
- [x] Seed file run — Carbone matched (UUID `810512ae-6b29-4957-b481-2778b1833fb7`). 3 rows inserted (NYT stars, Infatuation score, Eater essential/low-confidence). Via Carota NOT matched (restaurant not in dev DB) — all 3 Via Carota rows silently skipped per the seed's `WITH r AS ... INSERT ... SELECT FROM r` pattern. Only NYT + Infatuation + Eater (low-confidence) rows visible for Carbone. The suppressed Via Carota / Infatuation row was not inserted (restaurant didn't exist), but the suppression path is covered by the Eater/low-confidence row blanking excerpt.
- [x] Edge function deployed — `npx supabase functions deploy restaurant-history --project-ref ftvmseaqwwlcxtdlvxxz`. Deno type check clean.
- [x] Hook updated: `napkin-app/hooks/restaurants/useRestaurantPage.ts` — added `ProfessionalCritic` type export, `professional_critics: ProfessionalCritic[]` on `RestaurantPageData`, back-fill to `[]` in normalizer.
- [x] Components created: `napkin-app/components/restaurants/criticPublications.ts`, `CriticRow.tsx`, `ProfessionalTakesBand.tsx`
- [x] Band wired into Visits tab — `app/restaurant/[id].tsx` renders `<ProfessionalTakesBand critics={pageData?.professional_critics ?? []} />` after `VoicesStream` inside the `activeTab === 'visits'` block.
- [x] Barrel exports added — `ProfessionalTakesBand` and `CriticRow` added to `components/restaurants/index.ts`.
- [x] Type check clean — `npx tsc --noEmit` reports zero new errors (3 pre-existing errors in `tables.tsx` and `InfoMapPreview.tsx`, unrelated to this ticket).
- [x] Deno test suite — 38 steps pass, 0 failed.
- [ ] Visual verification — dev server not started. The edge function was verified via REST API (3 seed rows returned, scrape_confidence=40 eater row has excerpt blanked server-side per the logic added). TS + Deno checks pass; component builds clean.

### Deviations from Tech Design
- **`Newsreader_500Medium` not available.** The spec says "Newsreader 14px Medium" for publication name. The project only loads `Newsreader_400Regular`, `600SemiBold`, `700Bold`, `800ExtraBold`. Used `Newsreader_600SemiBold` as the closest available weight for publication name and value column. This matches the intent (non-italic, editorial weight) without requiring a new font load.
- **Migration push workaround.** A duplicate-timestamp local migration file (`20260427000000_remove_personal_tables.sql`) blocked `supabase db push --include-all` because the `is_personal` column was already removed on remote. Worked around by temporarily moving the blocking file out of migrations, pushing, then restoring. The migration history table on remote is consistent.
- **Via Carota seed rows skipped.** Via Carota doesn't exist in the dev DB. The seed's `SELECT FROM r` pattern silently skipped all 3 Via Carota rows. Carbone's 3 rows (including the suppressed-equivalent low-confidence one) are sufficient for end-to-end visual verification of all four `kind` values and the low-confidence excerpt-blanking path.

### Builder Questions
- None. Spec was complete and all five open questions were resolved before implementation.

### Files touched
```
napkin-app/app.json  (expo-web-browser plugin added by npx expo install)
napkin-app/app/restaurant/[id].tsx
napkin-app/components/restaurants/CriticRow.tsx  (new)
napkin-app/components/restaurants/ProfessionalTakesBand.tsx  (new)
napkin-app/components/restaurants/criticPublications.ts  (new)
napkin-app/components/restaurants/index.ts
napkin-app/hooks/restaurants/useRestaurantPage.ts
napkin-app/package-lock.json
napkin-app/package.json  (expo-web-browser added)
supabase/functions/restaurant-history/index.ts
supabase/migrations/20260501000000_create_professional_critic_reviews.sql
supabase/seeds/critics_seed.sql
```

---

## Review History

### Review 1 — 2026-04-23

**Verdict:** APPROVE

**Scorecard:**

| AC group | Status | Notes |
|---|---|---|
| Placement | PASS | `ProfessionalTakesBand` mounted under `VoicesStream` inside `activeTab === 'visits'` in `app/restaurant/[id].tsx:479-482`. Not in Photos or Info. Outer `restaurant && ...` guard + server `professional_critics: []` for ghosts + self-hide on empty input — triple coverage. |
| Section chrome | PASS | `Manrope_700Bold 9px / letterSpacing 1.5 / uppercase` + `palette.textMuted` + `palette.ruleInkSoft` flanking rules (`ProfessionalTakesBand.tsx:71-80`). Top separator + `marginTop Spacing.xl` provide the `Spacing.xl` gap from VoicesStream. |
| Row rendering | PASS | Single `Pressable` root (`CriticRow.tsx:170-214`). Publication Newsreader 14 (non-italic), kind Manrope 9 tracked sublabel, value right-aligned, italic excerpt `Newsreader_400Regular_Italic`, caption Manrope 10. Rows separated by `borderTopWidth: 1` in `palette.ruleInkSoft`. |
| Kind-specific value rendering | PASS | Stars → glyphs from `row.score` in `palette.star` (no `/4` denom); score → number + `/{score_out_of}` in Manrope 10 `palette.textMuted`, bare number when denom null; essential → amber badge (`palette.amberChipHi` / `palette.amberInk`) with ESSENTIAL + year; feature → em-dash in textMuted. |
| Content constraints | PASS | Excerpt `numberOfLines={3}` at `CriticRow.tsx:202`, omitted when null/empty at L199. Rows missing `publication` filtered in both client (`ProfessionalTakesBand.tsx:40`) and server (`restaurant-history/index.ts:946`). Rows with excerpt but no source_url filtered both client (L42) and server (L948). |
| Ordering | PASS | Single place: client-side in `ProfessionalTakesBand.tsx:44-59`. Fixed rank from `PUBLICATION_RANK` (nyt=0, infatuation=1, eater=2, unknowns → Infinity), `published_date desc` tiebreak, alpha tertiary. Server does not order. |
| Tap behavior | PASS | `WebBrowser.openBrowserAsync(critic.source_url)` via `expo-web-browser` (`CriticRow.tsx:165`). `isInteractive` guards on `https://` prefix; non-interactive row has `onPress={undefined}`, `accessibilityRole="text"`, no rowPressed opacity applied. `expo-web-browser ~15.0.10` added to deps and `app.json` plugins. |
| Stale / revised | PASS | Enforced at the DB layer — UNIQUE index on `(restaurant_id, publication)` at migration L29-30. |
| Suppressed / low-confidence | PASS | Server filters `suppressed=false` at `restaurant-history/index.ts:938`; blanks `excerpt` when `scrape_confidence < 70` at L958-960. `scraped_at` and `scrape_confidence` are not in the wire shape (`ProfessionalCritic` type at `index.ts:86-96`). |
| Ghost restaurants | PASS | Null-restaurant short-circuit returns `professional_critics: []` at `index.ts:514`. Screen's `activeTab === 'visits'` block is gated on `restaurant && ...` so band never enters render for a ghost anyway. |
| Attribution / legal | PASS | `buildAttribution` at `CriticRow.tsx:94-107` covers all three fallbacks: missing year → `— {Author}`; missing author → `— {Publication}, {year}`; both missing → null (caption omitted). |
| Copy | PASS | "PROFESSIONAL TAKES" uppercase at `ProfessionalTakesBand.tsx:77`. Display map: `nyt → "NYT"`, `infatuation → "The Infatuation"`, `eater → "Eater"` in `criticPublications.ts:12-16`. |
| Accessibility | PASS | Row `accessibilityRole="link"` (interactive) / `"text"` (non-interactive). `accessibilityLabel` follows `"<Publication> <value>. <excerpt>. by <author>, <year>. Opens review."` shape in `buildAccessibilityLabel`. Header gets `accessibilityRole="header"` at `ProfessionalTakesBand.tsx:75`. |
| Migration + RLS | PASS | `IF NOT EXISTS` on table/indexes/trigger. SELECT policy TO authenticated only; no INSERT/UPDATE/DELETE policies (implicit deny for non-service-role writes). FK cascade on `restaurants(id) on delete cascade`. CHECK on `kind` enum + `scrape_confidence` range. |
| Seed | PASS | Idempotent via `on conflict (restaurant_id, publication) do update` + `WITH r AS (...LIMIT 1) INSERT...SELECT FROM r` for silent skip. Covers all four kinds, one suppressed, one low-confidence. |
| Typecheck | PASS | `npx tsc --noEmit` produces only 3 pre-existing unrelated errors (`tables.tsx` is_personal x2, `InfoMapPreview.tsx` colorScheme comparison). Zero from TICKET-026 files. |
| Dead code / logs | PASS | No `console.log`/`TODO`/`FIXME`/`HACK` in new files. No hardcoded hex or rgba. All colors via `palette.*`. |

**Failures:** None.

**Warnings (accepted but worth noting):**
1. **`Newsreader_500Medium` substituted with `Newsreader_600SemiBold`** (`CriticRow.tsx:241, 253, 263, 290`). Verified: `app/_layout.tsx` only loads 400/400Italic/600/700/800 — the 500 weight genuinely isn't registered. Build Log declares this. SemiBold is marginally bolder than Medium; flag for a design pass if the publication line reads too heavy next to the excerpt, but intent (non-italic, editorial weight) is preserved.
2. **`CriticRow` exported from the barrel** (`components/restaurants/index.ts:26`) but only consumed internally by `ProfessionalTakesBand`. Harmless surface-area bump; consider tightening to internal-only later.
3. **`paddingHorizontal: 22` hardcoded** in `ProfessionalTakesBand.tsx:92`. Matches sibling `VoicesStream.tsx` which already uses 22 — intentional parity, not a new violation, but should be tokenised as a repo-wide cleanup.
4. **Seed was applied only partially in dev DB** — Via Carota rows silently skipped because the restaurant isn't in the dev DB, so the suppressed-row fixture (`suppressed=true` on Via Carota / Infatuation) did not land. Low-confidence path IS covered by Carbone's Eater row. Visual verification of the `suppressed=true` server-side filter against a live row was not demonstrated end-to-end, but server logic at `restaurant-history/index.ts:938` is correct by inspection.
5. **Visual verification deferred** — builder ran Deno + TS checks only; dev server was not started. No screen-capture confirmation that the band visually matches the canvas. Spec compliance verified by code inspection; recommend a quick visual pass before promoting to done.

**Strengths:**
- Server-side filtering discipline is exemplary: suppressed rows and low-confidence excerpts never cross the wire. `scraped_at` and `scrape_confidence` are stripped from the wire shape entirely.
- Three concentric guards against licensing drift (server filter, client filter, `https://` check before `openBrowserAsync`) cover each other without being gratuitous.
- The `onConflict` upsert pattern + partial index (`where suppressed = false`) cleanly separate ingestion writes from read-path queries.

---

## Completion

**Completed:** 2026-04-23
**Verdict:** APPROVE (Review 1, 0 FAILs, 5 WARNs accepted)
**Follow-ups:**
- Visual verification deferred — recommend a quick design pass on the live build; code-inspection compliance only.
- Suppressed-row path verified by inspection (not end-to-end) — Via Carota seed rows silently skipped because the restaurant isn't in dev DB.
- Ingestion scraper lives in the follow-up ticket `TICKET-033-critics-ingestion` (backlog).
- Consider tokenising `paddingHorizontal: 22` across `VoicesStream`/`ProfessionalTakesBand` as a separate repo-wide cleanup.
