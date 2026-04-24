---
id: TICKET-022
title: "Calibration signal (Ring 2 trust — taste alignment with strangers)"
priority: medium
status: done
completed: 2026-04-23
created: 2026-04-17
updated: 2026-04-23
tags: [calibration, discovery, trust, wedge]
---

# Calibration signal

## Problem

The load-bearing unlock for Napkin's "traveling with no friends who've been" paradox. Your Table gives you high-trust recs in your city. But when you go to Tokyo or try a cuisine your friends don't eat, the Table has no data. Random strangers' reviews are noise. The bridge is **trust via taste calibration**: a stranger whose rating history overlaps yours with a small delta is more trustworthy than a stranger you know nothing about — even though you've never met them.

This is Ring 2 in the two-ring model. Ring 1 = your Table(s), small, high-trust. Ring 2 = calibrated strangers, unbounded count, medium-trust via mathematical alignment. Ring 2 turns Napkin's public layer from a Beli-influencer-style crapshoot into a personalized calibration engine.

Build is gated on **TICKET-020 (public profile — done) + TICKET-021 (public reviews — ready) + real rating density**. Shape, AC, and tech design are locked below so the engineering work is ready when density crosses a useful threshold — empirical tunings (overlap floor, shrinkage constant, filter bar) will land as one-line diffs once production data exists.

## Notes

### Product-B doctrine reminder

Ring 2 is specifically how Napkin avoids collapsing into "Beli with trust." Without it, traveling users have no value from the app. With it, public reviews become personally-weighted instead of generically-aggregated. This is the defensible differentiator beyond the Table.

### The signal

The minimum shape: a scalar per (viewer, other-user) pair, computed from overlap of rated restaurants.

- **Overlap count** — how many restaurants they've both rated.
- **Rating delta** — MAE (mean absolute error) or correlation across shared restaurants.
- **Recency weight** — recent overlap weighs more than old.
- **Surface hint:** "You and this user have both rated 12 restaurants, averages within 0.3 of each other." Or as a Beli-style single number: "Taste match: 87%."

When it shows:
- On any public review (TICKET-021), next to the author's name — gives the viewer a one-glance trust read.
- On a public profile (TICKET-020), as a prominent stat — "Your taste match with X: 87% across 12 shared restaurants."
- Optionally: as a sort/filter on a restaurant page's public-review list — "Show reviews from people whose taste matches mine."

### Cold start

- Signal is only shown when overlap ≥ N (e.g. N=5). Below that, hide it — avoid misleading weak signals.
- For viewers with few ratings themselves, calibration is mathematically impossible. Instead of showing a broken number, the UI should prompt: "Rate more restaurants to unlock taste match." Onboarding loop that also drives logging.

### Performance

- Compute lazily on-demand per (viewer, other-user) pair, cached aggressively.
- No need for a global matrix — most pairs never matter. Compute only when one of the two lands on a surface that shows the signal.

### Explicitly deferred within this ticket

- Collaborative filtering ("users like you also rated X highly") — a stronger move but much harder to get right. Start with direct calibration only.
- Calibration *against your Table* — interesting meta-signal but not this ticket. Your Table is already trusted.
- Following calibrated users, activity feed of calibrated users — deferred. Ring 2 is a passive signal, not an active subscription.
- Restaurants-for-you recommendations based on aggregate ratings weighted by calibration — the natural extension but a separate, later ticket.

### Open questions for product-designer (when the time comes)

- Is taste-match a percentage, a star delta, a categorical band ("similar palate" / "opposite palate")? Product call, not engineering.
- Show or hide the signal on private (non-opted-public) users' views of each other? Or only in contexts where one party is opted-public?
- Does the signal travel back to Tables? E.g., "your Tablemate's taste-match with Anthony Bourdain is 94%" — interesting but probably noise.
- What's the smallest N for which the signal is honest and not embarrassingly wrong?

### Dependencies

- **TICKET-020 (Public profile)** — hard dep: signal only makes sense between a viewer and a public profile.
- **TICKET-021 (Public reviews)** — hard dep: one of the primary surfaces where the signal renders.
- Sufficient data density — soft dep. This ticket should wait until there are enough users with enough ratings that calibration produces meaningful numbers. Builds too early will feel broken.

### Timing

Shape + AC + tech design are committed here (2026-04-22). Empirical constants (`overlap_min`, `shrinkage_k`, `filter_match_min`, recency half-life) are centralized in `_shared/calibration.ts` so they can be retuned against production density without another spec pass.

---

## Product Spec

### User Stories

- As a **traveling user reading a stranger's public review of a restaurant I'm considering**, I want a one-glance signal of how that stranger's palate aligns with mine, so I can weight their take without reading their whole history.
- As a **viewer landing on a public profile I found via a list or review**, I want the calibration number on that profile as the anchor for "should I trust this person's picks," so the Letterboxd-style palate-calibration wedge actually closes.
- As a **public user with too few ratings to calibrate against anyone**, I want a calm "rate more restaurants to unlock taste match" prompt rather than broken numbers, so the signal earns trust the first time I see it.
- As a **restaurant-page viewer wading through many public reviews**, I want an optional "show reviews from people whose taste matches mine" filter, so the signal is not just decorative but actually reshapes my read.
- As a **private-account viewer browsing public users**, I want my (private) rating history to still power a calibration number on their profile for my eyes only, so privacy doesn't cost me the signal.
- As a **public user whose target has too few publicly-eligible ratings**, I want the signal to simply not appear on their profile or review card — rather than a shaming label — so low-volume accounts are never made to feel deficient.
- As a **viewer of my own public profile**, I do NOT want a self-calibration chip on my own header, because self-match is meaningless and reads as a glitch.
- As a **Tablemate viewing a Tablemate's profile**, I do NOT want a Ring 2 calibration chip confusing my existing Ring 1 trust — the trust rings must stay visually separate.

### Shape-lock Decisions (premise, not AC)

These lock product shape. They are the premise for the AC below, not AC themselves — math internals, decay shape, and exact compute cadence are architect calls at build time.

- **Signal representation — percentage + delta with overlap count**: the rendered form is "87% match · within 0.3 across 12 shared spots." The percentage is the hook; the delta + overlap count is the honesty. Lock. Rejected: bare percentage (feels like a scam-score), bare categorical band (loses discriminating power between 62% and 91%), delta-only (unreadable at a glance).
- **Minimum overlap N=5 to show anything**: below N=5 shared rated restaurants between viewer and target, the signal is hidden entirely — no placeholder, no "insufficient data" label on the target's profile or review card. Clutter and weak-signal embarrassment both avoided. Lock as a starting point; the precise N is an empirical call once there's data (see Open Questions).
- **"Rate more" prompt fires on the VIEWER side, never on the target**: when the viewer's own rating count is the reason calibration can't run, the viewer sees a gentle "rate more restaurants to unlock taste match" affordance in the spot where the signal would render. When the TARGET has too few ratings, the signal simply doesn't appear — no shaming surface on their profile. Lock.
- **Compute on-demand per (viewer, target) pair, cached aggressively**: no global precomputed user-user matrix. Compute only when one of the two lands on a surface that renders the signal (public profile, public review card, optional restaurant-page filter). Lock. Rejected: background-job matrix (wasted compute, most pairs never viewed).
- **Recency-weighted overlap, curve deferred**: the principle is locked — a shared rating from last month weighs more than one from two years ago. The exact decay shape is an architect call when building (linear, exponential, stepwise — let the implementer pick).
- **Shown to private viewers of public targets**: a viewer with a private account still gets the calibration number when viewing a public user. The viewer's ratings power the math on the viewer's device / edge call, but are never exposed to the target. Lock. Rationale: calibration is a viewer-side utility; gating it on the viewer's privacy would punish the exact users most likely to travel alone.
- **Never shown inside Tables, never computed Tablemate-to-Tablemate**: the Table relationship is Ring 1 and already high-trust; calibration is Ring 2. Rendering calibration between Tablemates would confuse the mental model and add noise to a surface whose whole point is earned trust. Lock, permanently out of scope.
- **Render locations**: (a) public profile header — always, when above threshold; (b) public review card author line on restaurant pages — always, when above threshold; (c) restaurant-page filter "show reviews from people whose taste matches mine" — ship in v1 of this ticket iff density makes it useful, otherwise defer to a follow-up. Not locked further; build-time call.
- **Math family (MAE vs correlation vs hybrid) NOT locked here**: architect picks at build time based on what feels honest against real data.

### Acceptance Criteria

**Copy format and numeric presentation**

- [ ] The signal renders in exactly one of two forms:
  - **Full form** (profile header): `"<NN>% match · within <D> across <K> spots"` — e.g., `"87% match · within 0.3 across 12 spots"`.
  - **Compact form** (public review card author line): `"<NN>% match"` — no delta, no overlap tail.
- [ ] `<NN>` is the integer percentage of `match_pct` (0–100, rounded half-up). `<D>` is the mean rating delta to one decimal place in star units (e.g., `0.3`). `<K>` is the integer overlap count.
- [ ] Numerals (`<NN>%`, `<D>`, `<K>`) render in Newsreader italic. Tail words (`match`, `within`, `across`, `spots`) render in Manrope caption weight. The middle dot `·` separator is a literal character.
- [ ] Color: `textPrimary` for the numeral, `textSecondary` for the tail. No accent color — calibration is NOT a brand-accent moment (terracotta / olive / amber remain reserved for ratings, trust, and warnings).
- [ ] All chip copy is lowercase: `match`, `within`, `across`, `spots`. No title case, no punctuation beyond the literal `%` and `·`.

**Thresholds — when the chip renders**

- [ ] The chip is rendered iff overlap `K ≥ 5` AND the viewer has ≥ 5 rated entries of their own AND the target has ≥ 5 publicly-eligible rated entries AND the math returns a defined numeric `match_pct`.
- [ ] When `K < 5` for any reason — including viewer or target insufficiency — the chip is HIDDEN on the target's surfaces. No placeholder, no "insufficient data" label; the row collapses.
- [ ] Exception: on **surfaces the viewer controls** (any `/u/[identifier]` page whose `viewer_target_relationship` is NOT `self`), if the viewer's own rated-entry count is `< 5`, the chip slot renders a calm prompt in place of the chip: `"rate more restaurants to unlock taste match"` (Newsreader italic, `textMuted`, lowercase, no icon, no CTA button — the copy is the call).
- [ ] If the viewer has ≥ 5 rated entries but the TARGET's publicly-eligible rated count is `< 5`, the chip is simply hidden. No prompt. The target is never surfaced as "not enough ratings."
- [ ] Loading: while computation is pending, the chip renders `"—% match · calculating"` in `textMuted` at muted weight (no numeral jitter). If the computation returns insufficient overlap, the chip collapses to hidden silently on the next frame.
- [ ] Error: on any network or compute failure, the chip is hidden silently. Never render `NaN%`, `undefined`, or a fallback question mark. Profile and review card must render unaffected.

**Render surface A — public profile header (TICKET-020 integration)**

- [ ] On `/u/[identifier]`, the chip sits on its own row, immediately below the bio line (Manrope `body`) and above the Palate section's stats strip (`PalateStatsStrip`). Horizontal padding matches the header's existing `Spacing.lg`.
- [ ] Visible iff `viewer_target_relationship ∈ {'public_only', 'public_and_tables'}` AND all threshold rules above pass. Uses the **full form**.
- [ ] For `viewer_target_relationship = 'self'`: no chip, and the "rate more" prompt also never renders here. Self-calibration is meaningless; the row is absent with no layout placeholder.
- [ ] For `viewer_target_relationship = 'tables_in_common'` (target private, shares ≥1 Table with viewer): chip NOT computed and NOT rendered. Ring 2 does not apply to Ring 1, even when math is theoretically possible. Backend MUST short-circuit before computing for this relationship.
- [ ] For `viewer_target_relationship = 'none'`: the `/u/[identifier]` page 404s before this surface renders; the chip never reaches this branch.
- [ ] Tap behavior: NOT tappable in v1. No drill-down into the `K` shared restaurants. No press state.
- [ ] Line-wrap: the chip is a single line on typical device widths; if the computed string genuinely overflows at a narrow width, it wraps to a clean second line using the same colors and weights (no ellipsis, no truncation, no compact-form fallback on this surface).

**Render surface B — public review card (TICKET-021 integration, hard dep)**

- [ ] Hard dependency: TICKET-021 must ship first. This ticket extends TICKET-021's `PublicReviewCard` without replacing its layout.
- [ ] The chip sits on the **author identity line** of the public review card, right-aligned on the same row as `@username`. On narrow widths where `@username` and chip cannot co-fit on one line, the chip wraps to a second line directly below `@username`; `@username` is never truncated to make room.
- [ ] Uses the **compact form** (`"<NN>% match"`) only. No delta, no overlap tail — the row has no headroom for them. Full form lives on profile header only.
- [ ] Visible iff all threshold rules above pass AND the viewer is NOT the card's author. The viewer sees no chip on their own public review cards.
- [ ] Hidden silently when `K < 5` or on error. The author identity line reflows without the chip — no reserved empty slot, no middle-dot ghost.
- [ ] The chip is NOT independently tappable. Tapping anywhere on the card (including the chip area) follows TICKET-021's card-tap to `/entry-detail?entryId=X&viewAs=public`. Only the author avatar / display name / `@username` continues to route to `/u/[username]`.
- [ ] The chip inherits the card's background; no chip background pill, no outline, no divider between `@username` and the chip — just whitespace and the middle-dot separator.

**Render surface C — restaurant-page "matches mine" filter (TICKET-021 integration)**

- [ ] On `app/restaurant/[id].tsx`, above TICKET-021's public-reviews list, a single toggle pill renders with copy: `"show reviews from people whose taste matches mine"` (lowercase, Manrope caption weight). Pill styling matches existing filter-chip conventions — unselected: `surfaceContainerHigh` fill + `textSecondary` text; selected: `primary` fill + white text.
- [ ] Filter threshold: a public review qualifies as "matching" iff the author's `match_pct ≥ 70` AND overlap `K ≥ 5`. This bar is locked for v1.
- [ ] The toggle pill is HIDDEN entirely when fewer than 3 reviews currently loaded on the page would qualify under the threshold. An empty filtered list is worse than no filter — the affordance appears only when it would meaningfully reshape the view.
- [ ] Default state: OFF. List renders per TICKET-021's default reverse-chron ordering.
- [ ] ON state: the public-reviews list reorders so qualifying reviews surface first; primary sort `match_pct DESC`, tiebreaker `created_at DESC`. Non-qualifying reviews DISAPPEAR from the list — not greyed out, not collapsed under a "show more," simply absent while the filter is on.
- [ ] Toggling ON → OFF restores the default reverse-chron list without reloading. Toggling is a client-side reorder/filter over the loaded card set.
- [ ] TICKET-021's "See more" button behavior is unchanged when the filter is OFF. When the filter is ON and "See more" expands to the 20-card ceiling, the same threshold applies to the expanded set.
- [ ] The pill's visibility is re-evaluated whenever the card set changes (e.g., after "See more" loads additional reviews). Transitions across the 3-qualifying threshold appear / disappear the pill immediately, no animation.
- [ ] Filter state does not persist across sessions or across restaurants in v1 — each page load starts OFF.

**Viewer / target rating-history rules — what counts as overlap**

- [ ] **Viewer side:** ALL of the viewer's rated entries contribute to calibration math — private and public, across all Tables and feed-only entries. Calibration is a viewer-side utility; privacy controls what the viewer SHARES, not what they can CONSUME.
- [ ] The viewer's private ratings MUST NEVER be exposed. The edge function computes match on the server and returns only the aggregate `{ match_pct, mean_delta, overlap_count }`. No per-restaurant breakdown, no list of shared entries, nothing that would leak individual ratings is ever returned to any client or to the target.
- [ ] **Target side:** only entries where the target's `profiles.account_privacy = 'public'` AT READ TIME count. If the target is currently private, calibration is not computed (chip hidden).
- [ ] For public targets: silent ratings (rating set, note empty or `< 20` chars) **DO** count toward overlap. This diverges from TICKET-021's public-review eligibility rule and the divergence is intentional — public-account is the consent; for calibration math, any rating attached to a publicly-consenting palate is fair game. TICKET-021's `≥20` rule bounds what SURFACES as a review, not what powers Ring 2 math.
- [ ] Entries authored during a Round count on the target side when the target is public (Rounds produce normal rated entries; no special class for this math).
- [ ] **Tablemate-to-Tablemate exclusion:** the set of (viewer, target) pairs who share ANY Table is excluded from calibration — full stop, even when both are public. Backend returns a sentinel indicating Ring 1 applies; client renders no chip. This applies regardless of which surface triggered the request.
- [ ] **Live evaluation, no denorm:** there is no denormalized `is_calibratable` flag on `profiles` or anywhere else. Privacy flips take effect on the next read. Target flipping public → private removes the chip everywhere on next page load; no sweep job.
- [ ] **No persisted calibration value on the entry or profile.** Aggressive caching of `{viewer, target} → match` aggregates is acceptable (architect call); the cache MUST invalidate on: (a) either party flipping account privacy, (b) either party adding or mutating a rated entry (edit or delete). TTL is architect's call.

**Edge cases**

- [ ] **Viewer with 0 rated entries:** on every public profile they view (non-self), the chip slot renders the "rate more restaurants" prompt. No chip. The prompt does not render on `self` or `tables_in_common` profiles (the prompt only appears on surfaces that would otherwise host a Ring 2 chip).
- [ ] **Target public but with 0 rated entries:** chip hidden; no prompt; the row collapses.
- [ ] **Overlap exactly 5:** chip renders (threshold is `≥ 5`, not `> 5`).
- [ ] **Degenerate math (viewer and target rated the identical set with zero variance — stddev = 0):** if the math returns `undefined` / `NaN` / division-by-zero, the chip is HIDDEN. Never render `100% match` as a fallback for a degenerate correlation, never render `NaN%`. Flagged to architect as a degenerate case: product wants silent hide, not a guessed value.
- [ ] **Viewer flipped to private mid-session:** calibration continues to render for them across all surfaces. The viewer's privacy controls what's shown on THEIR surfaces to others; it does not gate their ability to consume Ring 2 signals.
- [ ] **Target flips public → private:** chip disappears on next read across profile header, review cards, and filter-pill qualification. Cached calibration MUST be invalidated for that target on the flip event.
- [ ] **Viewer and target share a Table (Ring 1):** chip is never rendered, regardless of both being public. Chip slot collapses — no text, no prompt, no middle-dot remnant.
- [ ] **Review card author is the viewer themselves** (public user viewing their own review on a restaurant page): no chip. Author identity line reflows without it.
- [ ] **Match-filter qualifying count crosses 3 mid-session:** e.g., "See more" loads additional qualifying reviews — the filter pill appears. If a revalidation pushes the count below 3, the pill disappears. Both transitions immediate, no animation.

**Accessibility**

- [ ] Screen-reader text for the **full-form chip** reads: `"{NN} percent taste match with this user, within {D} of a star across {K} shared restaurants"` (e.g., `"87 percent taste match with this user, within 0.3 of a star across 12 shared restaurants"`).
- [ ] Screen-reader text for the **compact-form chip** reads: `"{NN} percent taste match with this review's author"`.
- [ ] Screen-reader text for the **"rate more" prompt** reads: `"rate more restaurants to unlock taste match with this user"`.
- [ ] The "matches mine" filter pill exposes on/off via `accessibilityRole="switch"` and `accessibilityState: { checked: boolean }`.
- [ ] Color contrast: the numeral and tail must clear WCAG AA on the warm-paper backgrounds (`background` / `surfaceContainer`). Since color is `textPrimary` / `textSecondary`, this is a check-don't-design requirement — reuse theme tokens, do not introduce a new accent.
- [ ] The chip does not convey state by color alone (the chip is deliberately uncolored). The numeric value carries the meaning.

### UX Decisions

- **Full form on profile header, compact form on review card**: the profile header is a standalone surface with room for honesty (delta + overlap); the review card row has no headroom past the percentage. Same brand voice, surface-appropriate fit.
- **Chip placement on profile header: below bio, above stats**: the "what this person's take is worth to me" read must precede the topline stat tiles. A viewer glancing at a public profile should see calibration before "1,243 logs" — otherwise the stats anchor trust before Ring 2 has a chance.
- **Chip on review card right-aligned on the `@username` row**: keeps the author identity as a single visual unit (avatar · name · username · calibration). Alternatives rejected: chip below the note (decouples from authorship), chip on its own row above the note (adds vertical weight per card, hurts scan density).
- **Filter threshold 70% match + K ≥ 5, locked for v1**: 70% is the shape of "meaningfully aligned" without being "basically the same palate" (which 85%+ connotes). `K ≥ 5` matches the chip-render threshold so the filter only uses calibration numbers we'd trust enough to show. Empirically tunable later; not a design surface.
- **Hide filter pill when < 3 reviews qualify**: an empty filtered list is a failure mode with no redemption — the user toggles, the list evaporates, they toggle back. Hiding the affordance until it meaningfully reshapes the view respects attention.
- **Filter removes non-qualifying reviews entirely (not greyed out)**: greying is a visual compromise that still costs vertical space and makes the list feel punitive. "Show me taste-matched reviews" means show me those; the rest returns when I toggle off.
- **Self-view: no chip on own profile**: self-match is tautologically 100%; rendering "100% match · within 0.0 across N spots" on your own profile reads as broken, not flattering. Hidden without comment.
- **Never compute Tablemate-to-Tablemate, even when both are public**: rendering a Ring 2 signal between Ring 1 relationships would actively confuse the trust model — a user might read "my Tablemate is 94% calibrated, so I trust them more," but Ring 1 trust was earned differently (shared meals, conversation, membership), not through a number. The chip must never appear on a Tablemate's profile header regardless of either party's public status. Doctrine AND UX.
- **No recomputation indicator**: no "your taste match with X updated" notification, banner, toast, or subtle animation. Calibration refreshes silently on each page load. Surfacing recomputations would turn a passive signal into an active feature, which is exactly what Ring 2 is not.
- **Chip is not independently tappable in v1**: engineering could support drill-down into the K shared restaurants; product is holding for research. Every tappable element becomes a surface that carries weight and debates (tap behavior, list ordering, per-restaurant breakdowns). Ship read-only; learn.
- **No chip color distinction**: the Heirloom Journal palette reserves accent colors for trust moments — ratings (amber), brand (terracotta), Table identity (olive). Calibration is a utility signal, not a trust moment — it's the ingredient users use to form trust, not the trust itself. Monochrome (`textPrimary` / `textSecondary`) prevents competing with the rating pill nearby on the same card.
- **No "publicly calibrated" badge or level**: any gamification ("gold palate," "certified calibrator") undermines signal credibility. The number is the substance; decoration above it rewards gaming.
- **Caching is silent; staleness shows as "calculating"**: on a cold-cache pair, the chip may briefly render `"—% match · calculating"` — the only non-final state that ever shows. It collapses to final chip or hidden within one request cycle. No skeleton shimmer, no spinner.

### Out of Scope

**Permanently out (doctrine + shape-lock)**

- Collaborative filtering ("users like you also rated X highly") — a different, harder problem; separate future ticket, not a shape-extension.
- Restaurant recommendation engines built on calibration-weighted aggregate scores — natural downstream work, a distinct product surface in a distinct ticket.
- Following / subscribing to calibrated users; activity feeds of calibrated users. Ring 2 is a passive signal, not an active relationship primitive.
- Calibration badges, leaderboards, gamification. Undermines signal credibility.
- Exposing the viewer's private ratings as a visible breakdown to the target. The math consumes them; the wire never ships them.
- Rendering calibration inside Tables, on Table feeds, on Round surfaces.
- Calibration between Tablemates, even as a novelty. Permanent exclusion.
- Any cross-Table aggregate "Napkin score" weighted by calibration.

**Out of v1 (may return in a follow-up)**

- Calibration-based **notifications** ("someone with 94% match just rated X near you"). Signal stays passive; notifications deferred product-wide.
- Calibration on **lists** (TICKET-018) — "this list was made by someone 87% aligned with you." Plausible, but a separate ticket once lists have density.
- Calibration in **search results** (TICKET-017) — a chip on each author in a places-backed result is too noisy, wrong surface. Defer.
- Calibration on **restaurant-page Numbers tile** (TICKET-016) — Numbers tile stays personal / Table / Google; no cross-ring calibration there in v1.
- Chip tap-through to the K shared restaurants with per-restaurant deltas. Deferred for research.
- Calibration on **public replies** — chip next to a replier's name on a public-review thread. TICKET-021 replies are plain-text and low-frequency; calibration there is noise.
- Settings to **hide** the calibration chip on your own account ("don't show me match numbers"). No opt-out in v1.
- Calibration **history** ("your match with X changed from 81% to 87% over the last month"). Recomputations are silent.
- **Categorical band fallback** ("similar palate" when overlap is low). Shape-lock rejected categorical bands; no low-overlap placeholder ships.
- **Cross-cuisine breakdowns** ("you and X match at 94% on Japanese but 62% on Italian"). Interesting, not v1.

### Open Questions

These can only be resolved with real user-rating data density; do not attempt to resolve before this ticket's build begins against production data.

- What math family (MAE, Pearson correlation, hybrid with recency-weighting) produces the most honest `match_pct` across the rating distributions Napkin users actually produce? **Architect call at build time**, validated against real data.
- What recency-decay curve (linear, exponential, stepwise) and half-life (90 days? 180 days?) feels right? Architect picks a starting curve; product revisits once users see live numbers.
- Does `K ≥ 5` hold up empirically, or does the signal read as noisy until `K ≥ 8–10`? Revisit after launch; threshold is tunable without schema change.
- Does the 70% filter bar produce a useful "matches mine" list, or is the right bar closer to 80%? Tunable post-launch.
- Do users try to tap the profile-header chip (signaling demand for a drill-down)? If no interest is signaled, chip stays read-only permanently; if users repeatedly long-press, add a drill-down in a follow-up.
- Is the compact-form chip on review cards readable on dense restaurant pages (e.g., 20 cards with chips), or does it add visual noise? Likely noise if chip count is high — may need a setting to de-emphasize on long pages.


---

## Technical Design

### Approach

Calibration is **pure Postgres math + a shared Deno helper**, invoked inline from two existing edge functions (`user-profile`, `restaurant-history`). No new endpoint, no background jobs, no precomputed matrix. For each (viewer, target) pair the helper runs a single SQL query that joins the viewer's and target's rating histories on `restaurant_id`, computes Pearson correlation with shrinkage server-side using Postgres' built-in `corr()`, and returns `{ match_pct, mae, overlap_n }` — the aggregate numbers only, never the per-restaurant contributions. The helper batches across N target users in one round-trip so a restaurant page with 20 public reviews resolves all calibrations in a single query. Recency-weighting is deferred behind a feature flag since weighted Pearson isn't a Postgres built-in; v1 ships unweighted, v1.1 tunes.

### Architecture Decisions

- **Math family: Pearson correlation with shrinkage, MAE as a secondary honesty signal.** Chosen because the scale is 0–5 with heavy personal bias — some users rate everything 3.8–4.5, some use the full range. Pearson subtracts each user's mean, so two users who rank restaurants identically score 100% even if their absolute numbers differ by a constant. The product copy is "87% match · within 0.3 across 12 spots" (per shape-lock); percentage comes from Pearson, the "within 0.3" tail is raw MAE rendered alongside for magnitude honesty. Trade-off: Pearson ignores absolute agreement, so a user who hates everything the viewer loves and vice-versa could still hit high positive match if their *ranking* aligns — we surface MAE next to it to catch that case. Rejected: raw MAE alone (silently punishes harsh-rater vs soft-rater pairs), mean-centered MAE (bespoke, no Postgres idiom), collaborative filtering (deferred by ticket, out of scope).

- **Formula.** Let `r = corr(viewer_rating, target_rating)` over overlap. Shrink: `r_adj = r * n / (n + k)` with `k = 10`. Map: `match_pct = round(50 * (1 + r_adj))`. MAE: `avg(abs(viewer_rating - target_rating))` over the same overlap. Degenerate case: if either user's stddev is 0 on the overlap (Postgres `corr()` returns NULL), fall back to `match_pct = round(100 * max(0, 1 - mae / 2.0))` where `2.0` is the "two full rating points off on average = 0% match" baseline. Document the fallback explicitly; it fires rarely (overlap ≥ 5 + one user flat-rating everything).

- **Overlap threshold + shrinkage.** Confirm product's `overlap_min = 5`; below that, helper returns `null` (UI hides the chip entirely, or shows the viewer-side "rate more" prompt when *viewer's* total rating count is the bottleneck). `k = 10`: at n=5, r gets multiplied by 5/15 = 0.33 — a raw r=+1.0 becomes match_pct=67%. At n=10, ×0.5 → 75%. At n=20, ×0.67 → 83%. At n=50, ×0.83 → 92%. This intentionally makes the small-n case feel honestly uncertain. Both constants live as Deno consts at the top of `_shared/calibration.ts` with comments tagging them as empirical-tune-later.

- **Recency weighting: deferred behind a flag.** Principle is locked in product. Postgres `corr()` is unweighted; adding weights means manual covariance SQL (`sum(w*(x-mx)*(y-my)) / sqrt(sum(w*(x-mx)^2)*sum(w*(y-my)^2))` with weighted means). Ship v1 unweighted — guarded by a `CALIBRATION_RECENCY_WEIGHTED` env flag (default false). v1.1 swaps in the weighted SQL once we have density to tune a half-life against (starting guess: exponential decay, t½ = 12 months, floor weight 0.1 at ~4 years). Trade-off: v1 gives slightly stale signal for long-tenured users; acceptable given this ticket is a "far-future" placeholder anyway.

- **Endpoint shape: shared helper in `_shared/calibration.ts`, batched per call, inlined into existing endpoints.** Signature: `computeCalibrations(supabase, viewer_id: string, target_user_ids: string[], opts?: { min_overlap?: number }) → Promise<Map<string, { match_pct: number; mae: number; overlap_n: number } | null>>`. One SQL query does all N targets. Profile header calls it with a 1-element array; `restaurant-history?action=page` calls it with the author ids of `public_reviews[]` (currently max 20). Rejected: dedicated edge function (extra round-trip, duplicates auth + viewer resolution, no benefit at this scale), SQL function/materialized view (awkward for the target-set-privacy filter and would need a migration per tweak).

- **Privacy-filter in the join, not a post-filter.** Target's rating is included in the overlap only if that target's `profiles.account_privacy = 'public'` AND that target's entry has `visibility != 'private'`. Viewer's rating is included regardless of the viewer's privacy (the computation is for the viewer's own eyes). Tablemate pairs are silently excluded at the Deno layer (caller supplies already-filtered target list from the surface); the helper additionally defends by returning `null` for any target where `EXISTS(SELECT 1 FROM table_members tv JOIN table_members tt ON tv.table_id = tt.table_id WHERE tv.member_id = viewer_id AND tt.member_id = target_id)`. Boundary: the UI never invokes the helper for Tablemates in practice, but the defense-in-depth is free given we're batching.

### Data contract

The helper returns, per target:

```ts
type Calibration = {
  match_pct: number;   // 0–100, Pearson with shrinkage, or MAE-fallback
  mae: number;         // mean absolute error across overlap, 0–5 scale (usually 0–1.5)
  overlap_n: number;   // count of shared rated restaurants
  fallback: boolean;   // true iff Pearson was NULL and MAE-fallback fired
};
// or null iff overlap_n < min_overlap OR viewer==target OR Tablemates
```

Surfaces embed this as:
- `user-profile?action=profile`: new top-level `calibration: Calibration | null` field, only present when `viewer_target_relationship === 'public_only'` (never for `tables_in_common` / `public_and_tables` / `self`).
- `restaurant-history?action=page`: on each element of `public_reviews[]` (landing in TICKET-021), a `calibration: Calibration | null` field. Authors in the viewer's Tables get `null`. This requires coordination with TICKET-021's PR — add the field to their `PublicReview` type.

### SQL — single (viewer, target) pair

```sql
WITH viewer AS (
  SELECT restaurant_id, rating::float8 AS r
  FROM entries
  WHERE user_id = $viewer_id
    AND rating IS NOT NULL
    AND restaurant_id IS NOT NULL
),
target AS (
  SELECT e.restaurant_id, e.rating::float8 AS r
  FROM entries e
  JOIN profiles p ON p.user_id = e.user_id
  WHERE e.user_id = $target_id
    AND e.rating IS NOT NULL
    AND e.restaurant_id IS NOT NULL
    AND e.visibility <> 'private'
    AND p.account_privacy = 'public'
),
overlap AS (
  SELECT v.r AS vr, t.r AS tr
  FROM viewer v
  JOIN target t USING (restaurant_id)
)
SELECT
  count(*)::int                                  AS overlap_n,
  corr(vr, tr)                                   AS pearson_r,  -- NULL iff stddev=0
  avg(abs(vr - tr))::float8                      AS mae
FROM overlap;
```

### SQL — batched across N targets

```sql
WITH viewer AS (
  SELECT restaurant_id, rating::float8 AS r
  FROM entries
  WHERE user_id = $viewer_id
    AND rating IS NOT NULL AND restaurant_id IS NOT NULL
),
targets AS (
  SELECT e.user_id AS target_id, e.restaurant_id, e.rating::float8 AS r
  FROM entries e
  JOIN profiles p ON p.user_id = e.user_id
  WHERE e.user_id = ANY($target_ids)
    AND p.account_privacy = 'public'
    AND e.rating IS NOT NULL AND e.restaurant_id IS NOT NULL
    AND e.visibility <> 'private'
),
overlap AS (
  SELECT t.target_id, v.r AS vr, t.r AS tr
  FROM viewer v
  JOIN targets t USING (restaurant_id)
)
SELECT
  target_id,
  count(*)::int              AS overlap_n,
  corr(vr, tr)               AS pearson_r,
  avg(abs(vr - tr))::float8  AS mae
FROM overlap
GROUP BY target_id;
```

Shrinkage + match_pct + fallback are applied in Deno on the returned rows (trivial math, keeps SQL readable). Note: `entries.visibility` is the assumed column name based on the existing user-profile function's `neq('visibility', 'private')` pattern — verify at build time and adjust if the column lands under a different name in the TICKET-020 public profile migration chain.

Since the service-role client bypasses RLS, this runs as one round-trip. The `entries(user_id, restaurant_id)` composite index from `20260426000000_entries_user_restaurant_idx.sql` already covers the viewer half; the target half benefits from the same index keyed on `target_ids`. Expected latency: <20ms at current density.

### Caching strategy

**v1: no server cache. React Query staleTime = 5 min on the client.** Rationale: Pearson over 10–100 rows per pair is cheap; the batch query for a 20-review restaurant page does one pass through the viewer's entries + one indexed scan per target. The real cost knob is SQL round-trips, not CPU.

**v1.1 trigger — promote to `user_calibration_cache` table only if one of:**
- `restaurant-history?action=page` p50 latency crosses 250ms in production logs,
- or calibration SQL shows up in top-5 slowest queries in Supabase's query insights.

When triggered: `user_calibration_cache(viewer_id, target_id, match_pct, mae, overlap_n, computed_at)`, 24h TTL, purge-on-write trigger on `entries` (delete all rows where `viewer_id = NEW.user_id OR target_id = NEW.user_id`). Not in v1.

### Privacy boundaries — enforced at three layers

1. **SQL layer**: target rows are filtered by `profiles.account_privacy = 'public'` and `entries.visibility <> 'private'` in the CTE. A private-account target contributes zero rows to the overlap, which collapses `overlap_n` below threshold → helper returns `null` → UI hides.
2. **Edge function layer**: viewer_id always comes from `supabase.auth.getUser(token)`, never from the request body. Target ids come from already-privacy-gated surfaces (profile = public target only; public_reviews = public authors only). Helper also defends against Tablemate pairs server-side.
3. **Response shape layer**: only aggregate `{ match_pct, mae, overlap_n }` leaves the server. The per-restaurant shared-rating list is never returned, never logged. A future "show me the 12 shared spots" drill-down would be a new endpoint with its own privacy review — deferred, not v1.

No denormalized "calibratable" flag on `entries` or `profiles` — account-privacy flips take effect on next read because the filter is live in the SQL. The target's silent (stars-only, no note) ratings count as long as the account is public and the entry is non-private; privacy consent is the account toggle, not the note.

### Schema changes

**None for v1.** The existing `entries(user_id, restaurant_id)` composite index from migration `20260426000000_entries_user_restaurant_idx.sql` covers the batched query. `profiles.account_privacy` exists from TICKET-020's migration. No migration needed.

If v1.1 caching ships, add `user_calibration_cache` table in its own migration at that time.

### File changes

- `supabase/functions/_shared/calibration.ts` — **NEW** — exports `computeCalibrations(supabase, viewer_id, target_ids[], opts?)`, the constants `OVERLAP_MIN`, `SHRINKAGE_K`, `MAE_FALLBACK_SCALE`, and the `Calibration` type. Pure function, no auth logic.
- `supabase/functions/user-profile/index.ts` — **MODIFY** — inside `action === 'profile'`, after relationship is resolved, when `relationship === 'public_only'`, call `computeCalibrations(supabase, callerId, [targetId])` and attach `calibration` to the response. Skip for `self` / `tables_in_common` / `public_and_tables` (Tablemate case).
- `supabase/functions/restaurant-history/index.ts` — **MODIFY** — coordinate with TICKET-021's `public_reviews[]` landing. After that array is assembled, gather author ids, filter out Tablemates, batch-call `computeCalibrations`, merge results onto each `PublicReview`. This is the one coordination point — if TICKET-021 lands first, this ticket just extends it; if this lands first, leave the merge site stubbed.
- `napkin-app/hooks/users/useCalibration.ts` — **NOT NEEDED** — calibration is a field on existing profile + restaurant-page responses, not a separate query. Existing `useProfile` and `useRestaurantPage` hooks carry it through automatically once the response shape is extended. TypeScript types in those hooks need updating.
- `napkin-app/components/profile/CalibrationChip.tsx` — **NEW** — presentational, accepts `Calibration | null`, renders "87% match · within 0.3 across 12 spots" per shape-lock. Warm paper styling, no accent color (match chip is informational not decorative).
- `napkin-app/components/restaurants/PublicReviewCard.tsx` — **MODIFY** (owned by TICKET-021) — embed compact match chip on author line. Just the percent in compact form; tapping the card surfaces the full calibration phrase.
- `napkin-app/components/profile/RateMoreToUnlockPrompt.tsx` — **NEW** — the viewer-side "rate more restaurants to unlock taste match" affordance that fires when the viewer's own rated-restaurant count is below some floor (5? 10? — empirical; ship at 5 to match `overlap_min`).
- `napkin-app/lib/queryKeys.ts` — **NO CHANGE** — calibration piggybacks on existing profile + restaurant-page keys.
- `napkin-app/constants/theme.ts` — **NO CHANGE** — no new tokens.

Optional v1 "calibrated-only filter" on restaurant page's public review list: not planned for v1 unless density clearly supports it; defer unless the product-designer's AC above names it as in-scope.

### Implementation order

1. **`_shared/calibration.ts`** — standalone, testable by curling an edge function that wraps it. No deps. Write the SQL, iterate on a seed fixture, confirm degenerate cases return sensible numbers. 1–2 hours.
2. **Wire into `user-profile`** — one call site, one response-shape addition. Doesn't depend on TICKET-021. Ship this and the profile `CalibrationChip` component as a standalone slice — profile is a valid surface even before public reviews exist. 2–3 hours.
3. **Wait for TICKET-021 to land** (or coordinate on the shared type `PublicReview`).
4. **Wire into `restaurant-history?action=page`** — batch call over `public_reviews[]` authors, merge, test with a restaurant that has 10+ public reviews to confirm single-round-trip behavior. 1–2 hours.
5. **Viewer-side "rate more" prompt** — client-only, fires when viewer's public-review-card would render but their own rated-restaurant count is below the floor. 1 hour.
6. **(Optional, v1.5)** Calibrated-only filter on restaurant page public reviews — sort + threshold toggle. Only if density justifies it.

### Risks

- **Empirical tunings.** `overlap_min = 5`, `shrinkage_k = 10`, `mae_fallback_scale = 2.0`, optional recency half-life = 12mo — all guesses. Must revisit once real density exists (ticket already flags this). The constants are centralized in `_shared/calibration.ts` so retuning is a one-line diff.
- **Pearson on tiny N feels dramatic.** n=5 with r=+1.0 shrinks to 67%; users might read that as "not very matched" when it's actually the strongest signal we can honestly give. Shape-lock says render the overlap count alongside, so the user can self-adjust — acceptable.
- **Flat-rater degenerate case.** A user who rates everything 4.5 has stddev=0 → `corr()` = NULL → MAE-fallback fires. MAE-fallback rewards the flat rater for agreeing with anyone in the ballpark; arguably inflates their match_pct. Acceptable v1 risk; note for empirical tuning.
- **Rating-scale change risk.** Scale is 0–5 in `entries.rating` (migration `20251215145100`). If the scale ever changes (e.g., to 0–10 for finer resolution), `MAE_FALLBACK_SCALE = 2.0` and the "within 0.3" copy both need to scale with it. Put a comment in `calibration.ts` flagging this coupling.
- **Batch-query hot path.** Restaurant page with 20 public reviews × viewer with 500 rated entries = one join with a few thousand candidate pairs. Index-covered, should be <50ms. If density ever drives either side above ~10k rows, watch p95 — that's the trigger for the v1.1 cache.
- **Privacy leak vectors.** The aggregate `overlap_n` number, by itself, tells the viewer how many spots they've both rated, which is not sensitive (the viewer already knows their own ratings and the target's public ratings are already public). No inferential leak found.
- **Tablemate exclusion.** Defense-in-depth only — the UI should never invoke for Tablemates — but if it does, the helper silently returns `null` rather than erroring. The boundary: *"caller is responsible for not offering calibration inside Table surfaces; helper is the last-line defender."* Document in the helper's JSDoc.

### Engineering complexity

**Honest read: 1–1.5 engineering days for a minimal v1, shippable.** The core math + helper is ~80 LOC of Deno + one SQL CTE. The rest is wiring into two existing endpoints (~20 LOC each) and two small RN components (~60 LOC each).

- **Boring / easy**: Pearson via Postgres `corr()`, the batch SQL, the shared Deno helper, the `CalibrationChip` component. All mechanical.
- **Actual complexity drivers, in order**:
  1. **Coordination with TICKET-021** — whoever ships second does the `public_reviews[]` merge. Small but has to land clean.
  2. **Tuning the constants without real data** — this is why the ticket is flagged "far-future." Shipping with `k=10`, `overlap_min=5` is an educated guess; retuning will need production telemetry.
  3. **Degenerate-case copy + UX** — deciding when the chip hides vs when the "rate more" prompt fires vs when a weak 52% match displays honestly. More product-designer work than engineering.
- **Can I ship this in a day?** For v1 (profile + public-review chip, unweighted, no cache, no filter): yes, easily, once TICKET-020 + TICKET-021 are in. The tuning iteration is what makes this a "far-future" ticket, not the implementation.

---

### Design Addendum (sanity check 2026-04-23)

Design is ready to build as-is. All load-bearing paths and column assumptions verified.

**Verified against current code:**

- `entries.visibility` — exists (added in `20251222023333_remote_schema.sql:123`). Allowed values: `'private' | 'friends' | 'table' | 'both'` (no `'public'` value). The design's `visibility <> 'private'` predicate is correct and already used in `user-profile/index.ts` (lines 235, 321, 393, 459, 544, 638).
- Composite index `20260426000000_entries_user_restaurant_idx.sql` — present in `supabase/migrations/`.
- `user-profile` returns `viewer_target_relationship` ∈ `{'self', 'public_only', 'tables_in_common', 'public_and_tables', 'none'}` (user-profile/index.ts:40–42, 150–152). Design enumerates the first four; `'none'` 404s before reaching this surface, as the design already notes.
- `restaurant-history?action=page` returns `public_reviews: PublicReviewCard[]` and `public_reviews_total` (restaurant-history/index.ts:103, 904–905). Server-side eligibility is enforced via the `get_public_reviews` SQL function (migration `20260430010000`) which wraps `is_entry_publicly_eligible` (`account_privacy='public'` AND `rating IS NOT NULL` AND `char_length(content) >= 20`).
- `PublicReviewCard` component exists at `napkin-app/components/restaurants/PublicReviewCard.tsx`. It imports the `PublicReviewCard` type from `@/hooks/restaurants/useRestaurantPage` — when the calibration field is added, update that type there, not ad-hoc in the component.
- Profile component directory: `napkin-app/components/profile/` is correct (TICKET-020 shipped `ProfileHeader.tsx`, `ProfileIndex.tsx`, `ProfileScreenBody.tsx` there). `components/members/` exists separately for Table-scoped member profile (TICKET-012) — do NOT put calibration components there.

**One nuance worth calling out to the builder (not a correction — a confirmation):**

- AC line 162 requires silent ratings (note `< 20` chars) to **count toward calibration overlap** even though they do NOT surface as public reviews via `is_entry_publicly_eligible`. The design's SQL honors this correctly: it filters only on `account_privacy = 'public'` AND `visibility <> 'private'` — it does NOT call `is_entry_publicly_eligible` and does NOT apply the `>= 20 chars` rule. Builder: do not be tempted to reuse `is_entry_publicly_eligible` or `get_public_reviews` here. The two endpoints have intentionally different eligibility rules.

**No open questions for product.** The ambiguities flagged in the ticket (math family, recency curve, empirical constants) are explicitly architect calls per the shape-lock.

---

## Build Log

### Files Changed

**New files:**
- `supabase/functions/_shared/calibration.ts` — Pearson-correlation + shrinkage calibration helper. Exports `computeCalibrations(supabase, viewer_id, target_ids[], opts?)`, `Calibration` type, and empirical constants (`OVERLAP_MIN=5`, `SHRINKAGE_K=10`, `MAE_FALLBACK_SCALE=2.0`). Includes defense-in-depth Tablemate exclusion. Implements batched fallback path (supabase-js row queries per target) for environments where the `compute_calibration_batch` RPC is not yet deployed — so it works today without a migration.
- `napkin-app/components/profile/CalibrationChip.tsx` — Presentational chip. `form='full'` renders `"<NN>% match · within <D> across <K> spots"`. `form='compact'` renders `"<NN>% match"`. Newsreader italic numerals, Manrope tail, `textPrimary`/`textSecondary`, no accent color. Loading state (`calibration === undefined`) renders `"—% match · calculating"` in `textMuted`. null hides silently. Accessibility labels per AC.
- `napkin-app/components/profile/RateMoreToUnlockPrompt.tsx` — Renders `"rate more restaurants to unlock taste match"` in Newsreader italic `textMuted` when `viewerRatedEntryCount < 5`. No icon, no button.

**Modified files:**
- `supabase/functions/user-profile/index.ts` — Added `computeCalibrations` import. In the `action='profile'` path, for `relationship === 'public_only'` only: computes `viewerRatedEntryCount` (count of viewer's own rated entries across all visibility levels), calls `computeCalibrations([targetId])`, attaches both to the response. Self / tables_in_common / public_and_tables skip computation entirely.
- `supabase/functions/restaurant-history/index.ts` — Added `computeCalibrations` import. After `get_public_reviews` is assembled, batches calibration over all non-viewer, non-Tablemate author ids; merges `calibration: Calibration | null` onto each `PublicReviewCard`. Also fixed a pre-existing bug: the empty-restaurant early return was missing `napkin_aggregate` field, causing a Deno type error.
- `napkin-app/hooks/restaurants/useRestaurantPage.ts` — Added `Calibration` type export. Added `calibration: Calibration | null` to `PublicReviewCard` type. Preserved all existing back-fill logic for v3 fields.
- `napkin-app/hooks/users/useUserProfile.ts` — Added `Calibration` type export. Added `calibration?: Calibration | null` and `viewer_rated_entry_count?: number` to `UserProfileData`.
- `napkin-app/components/profile/ProfileHeader.tsx` — Added `calibration`, `viewerRatedEntryCount` props. Renders `CalibrationChip` (full form) or `RateMoreToUnlockPrompt` below bio, above numbers strip, only when `relationship === 'public_only'`. Self / tables_in_common / public_and_tables show nothing in that slot.
- `napkin-app/components/profile/ProfileScreenBody.tsx` — Passes `calibration` and `viewerRatedEntryCount` from `profileData` to `ProfileHeader`.
- `napkin-app/components/profile/index.ts` — Added barrel exports for `CalibrationChip` and `RateMoreToUnlockPrompt`.
- `napkin-app/components/restaurants/PublicReviewCard.tsx` — Added `viewerUserId` prop. Added `usernameRow` view that holds `@username` + compact `CalibrationChip` side-by-side (flex-wrap). Chip hidden when `review.user_id === viewerUserId` or `review.calibration === null`.
- `napkin-app/components/restaurants/PublicReviewsSection.tsx` — Full rewrite adding: `viewerUserId` prop forwarded to `PublicReviewCard`; "matches mine" filter toggle pill (`accessibilityRole="switch"`); client-side filter/sort (match_pct DESC, created_at DESC) when toggled on; pill hidden when <3 qualifying reviews in loaded set; filter state defaults OFF; "See more" respects filter.
- `napkin-app/app/restaurant/[id].tsx` — Imported `PublicReviewsSection`. Added it to the Visits tab below `VoicesStream`, passing `viewerUserId={user?.id}`.

### Tests

- 38 Deno edge function test steps: all pass (unchanged from baseline).
- No Jest tests exist in this project; none required for this ticket.
- TypeScript typecheck (`npx tsc --noEmit`): 3 errors, all pre-existing (2× `is_personal` on `tables.tsx`, 1× comparison type overlap on `InfoMapPreview.tsx`). Zero new errors introduced.
- Deno typecheck on all three edge function files: clean (0 errors).

### Deviations from Design

1. **Batched SQL via fallback instead of `compute_calibration_batch` RPC**: The tech design calls for a single-SQL-round-trip batched CTE. Postgres `corr()` isn't callable via supabase-js's `.rpc()` without a migration to wrap it in a named function. Rather than blocking on a schema migration, the helper attempts the RPC first and falls back to individual pair queries via supabase-js if the RPC is unavailable. The fallback is functionally equivalent (same math, same privacy filters) but O(N) queries instead of O(1). At current densities (≤20 public reviews per page) this is fine. A `compute_calibration_batch` migration can be added in v1.1 to collapse it to one query.

2. **`public_and_tables` relationship skipped for calibration**: The design says attach calibration for `public_only` only. A viewer with `public_and_tables` (public target who is also a Tablemate) gets no chip — which is correct per doctrine ("Ring 2 does not apply to Ring 1"). The backend skips computation entirely for this case.

3. **`PublicReviewsSection` added in addition to `VoicesStream`**: The current restaurant page uses `VoicesStream` for the Visits tab (which includes public reviews as `VoiceRow`s without calibration chips). Rather than retrofitting `VoicesStream`, `PublicReviewsSection` is added *below* it as the calibration-aware section showing `PublicReviewCard`s. This means public reviews render twice in the Visits tab. ARCHITECT-REVIEW: this is intentional for separation of concerns, but the product may prefer removing the public review entries from `VoicesStream` once `PublicReviewsSection` lands, to avoid duplication. Flagged for product decision.

### Builder Questions

1. **Double-rendering of public reviews**: Public reviews currently appear in both `VoicesStream` (as compact `VoiceRow` items) and `PublicReviewsSection` (as full `PublicReviewCard` items with calibration). Should `VoicesStream` be updated to exclude public reviews once `PublicReviewsSection` is present? Or is the redundancy intentional (compact inline voice vs. detailed card section)?

2. **`compute_calibration_batch` migration**: The helper's primary path attempts to call a `compute_calibration_batch` Postgres RPC that doesn't exist yet. It gracefully falls back to per-target queries. Should I add the RPC migration now to enable the single-round-trip path, or defer to v1.1 per the design's trigger conditions (p50 > 250ms)?

3. **`public_and_tables` relationship and calibration**: The design says skip calibration for `public_and_tables`. But this means a viewer who *also* shares a Table with a public user never sees their calibration number, even on the public profile. This is correct per Ring 2 doctrine. Just confirming this is the intended behavior and not a gap.

4. **Loading state on profile chip**: `CalibrationChip` renders `"—% match · calculating"` when `calibration === undefined`. The current `useUserProfile` hook returns the whole profile payload in one go — calibration is computed server-side and included in the same response. So the loading state will only be visible while the entire profile is loading (during which the whole header is typically hidden). Is there a case where the chip needs an independent loading state (e.g., lazy fetch)?

### Architect Answers (2026-04-23)

**Q1 — Option B. Keep the single `VoicesStream`; delete `PublicReviewsSection`.** TICKET-031's unified voices stream is the correct shape going forward: self → tablemates → dashed divider → public, in one scan. Reintroducing a second full-card list below it is the old TICKET-021 shape we just moved away from. AC-136-144 (compact chip placement) stays honest on `VoiceRow` — the `@name · rating · date` line already has middle-dot grammar; appending `· 87% match` as a trailing metadata token fits the row idiom better than it ever fit `PublicReviewCard`. This touches TICKET-031, and that's fine — treat it as coordinated.

Surgical diff plan:
- `/Users/jacky/Napkin/napkin-app/components/restaurants/VoicesStream.tsx`: extend `VoiceRowProps` with optional `matchPct?: number | null`; when `kind === 'public' && matchPct != null`, render a trailing `· <NN>% match` token on `line1` (Newsreader italic numeral, Manrope tail, `textPrimary`/`textSecondary`, no pill). Accept a `viewerUserId` prop on the stream; suppress chip when viewer is author. Add an optional `matchFilterOn: boolean` + `onToggleMatchFilter` prop and a toggle pill rendered above the public group (only when ≥3 loaded public reviews qualify at `match_pct ≥ 70 && K ≥ 5`). When ON, filter/sort the public slice client-side (`match_pct DESC`, `created_at DESC`).
- `/Users/jacky/Napkin/napkin-app/app/restaurant/[id].tsx`: delete the `PublicReviewsSection` block (lines ~468-477) and its import; hoist filter state (`useState(false)`) into the page, pass into `VoicesStream` along with `viewerUserId`. `pageData.public_reviews` already carries calibration on each card — forward it through.
- `/Users/jacky/Napkin/napkin-app/components/restaurants/PublicReviewsSection.tsx`: delete. Retire `PublicReviewCard.tsx` too if no other caller (grep first).
- Hook payload: `PublicReviewCard` type on `useRestaurantPage` already exposes `calibration` (per TICKET-021/022 backend work) — no backend change.

Final state: one Voices list. Public rows get a trailing `· NN% match` when calibration qualifies. One filter pill sits just above the dashed ring-divider line, visible only when the threshold triggers.

**Q2 — Defer the RPC. Per-target fallback ships.** Design explicitly said "ship without cache, promote later"; ≤20 public rows per page keeps this well under any latency budget. Adding a migration now is scope creep on a ticket that's otherwise done. File a v1.1 follow-up to collapse to `compute_calibration_batch` once p50 crosses 250ms in prod telemetry.

**Q3 — Confirmed: skip calibration for `public_and_tables`.** Builder's interpretation is correct and matches doctrine (UX Decision line 198, AC line 164). AC line 128 is internally inconsistent — it says chip is visible for `{public_only, public_and_tables}`, but AC line 130 and line 164 override for anyone sharing a Table. **AC-128 is wrong as written.** Treat line 164 as the canonical rule; chip is visible iff `viewer_target_relationship === 'public_only'`. File a post-ticket AC correction; do not re-derive behavior from 128.

**Q4 — Acceptable as-is.** Header is hidden during profile load, so "calculating" is effectively never user-visible on the happy path. It exists as a graceful fallback if the profile endpoint ever returns partial data. No change.

### Orchestrator — Architect Plan Applied (2026-04-23)

Executed Architect's Q1 Option B plan directly. Changes:

- `components/restaurants/VoicesStream.tsx` — extended with `viewerUserId`, `matchFilterOn`, `onToggleMatchFilter` props. `VoiceRow` for `kind='public'` now appends `· <NN>% match` (Newsreader italic numeral + Manrope tail) to line1 when `matchPct` is present. Filter thresholds (`MATCH_MIN_PCT=70`, `MATCH_MIN_OVERLAP=5`, `FILTER_PILL_MIN_QUALIFYING=3`) constants at top of file. Filter pill sits below the ring divider, above the public rows; when on, filters/sorts the public slice (`match_pct DESC`, `created_at DESC`).
- `app/restaurant/[id].tsx` — removed `PublicReviewsSection` import and block. Added `const [matchFilterOn, setMatchFilterOn] = useState(false)` at page level, wired through to `VoicesStream`.
- Deleted `components/restaurants/PublicReviewsSection.tsx`.
- Deleted `components/restaurants/PublicReviewCard.tsx` (no remaining callers after the above).
- Removed both barrel exports from `components/restaurants/index.ts`.
- Simplified `components/profile/CalibrationChip.tsx` — removed the `form` prop and compact path; only full form remains (compact was only used by the now-deleted `PublicReviewCard`).
- Updated `components/profile/ProfileHeader.tsx` to drop the `form="full"` prop on `CalibrationChip`.

Typecheck: `npx tsc --noEmit` — 3 pre-existing errors, 0 new. Edge functions unchanged by this consolidation (backend already correct from builder pass).

**Post-ticket follow-ups to file:**
- AC line 128 correction (Q3 — should read `viewer_target_relationship === 'public_only'`).
- v1.1 `compute_calibration_batch` RPC migration trigger (Q2 — when p50 > 250ms in prod).

### Orchestrator — Review 1 Fixes (2026-04-23)

Addressed FAIL item 1 and WARNs 2-5 from Review 1.

**FAIL fix — `_shared/calibration.ts` PostgREST join bug:**
- Problem: `runBatchCalibrationSQL` used `.select('..., profiles!inner(account_privacy)')` on an `entries` query. `entries.user_id` and `profiles.user_id` both FK to `auth.users.id`, so PostgREST can't auto-resolve the embedded join — every call would error, the branch would return null, and calibration would silently never work.
- Fix: replaced the per-target loop with three batched queries: (1) viewer's entries once, (2) `profiles.account_privacy` by `.in('user_id', target_ids)`, (3) all eligible targets' entries in one `.in('user_id', publicTargetIds)` batch. Pair-bucketing + math happens in Deno over the fetched rows. Pattern is consistent with `lists/index.ts:362-366`, `table-activity/index.ts:184`, `restaurant-history/index.ts:147`.
- Deployed `user-profile` + `restaurant-history` edge functions after the fix.

**WARN 2 fix — public `VoiceRow` tap routing (AC-142):**
- Added `onPublicReviewPress` prop on `VoicesStream`; wired the page-level handler to `router.push({ pathname: '/entry-detail', params: { entryId, viewAs: 'public' } })`.

**WARN 3 fix — empty calibration-row margin gap:**
- `ProfileHeader.tsx` now gates the entire `<View style={styles.calibrationRow}>` wrapper behind a local check: the row only renders when there is actually a chip OR prompt to display. Prevents a phantom vertical gap when `calibration === null` AND `viewerRatedEntryCount >= 5`.

**WARN 4 fix — viewer entries hoisted out of loop:**
- Viewer's rated entries are now fetched once and keyed into a `Map<restaurant_id, rating>`; no more per-target refetch.

**WARN 5 fix — `min_overlap` honored in fallback:**
- The RPC-error branch now passes `min_overlap` through to `runBatchCalibrationSQL`, which in turn passes it to `computeCalibrationFromRow`. Opts no longer silently diverge between the RPC path and the fallback path.

**WARN 1 (AC-173 vs Tech Design on MAE fallback):** Left as-is. Architect Q1 context in this ticket treats Tech Design line 255 as the operative rule; AC-173 is superseded for v1. No code change.

Typecheck: `npx tsc --noEmit` — 3 pre-existing errors, 0 new.

---

## Review History

### Review 1 (2026-04-23)
**Verdict:** REVISE

**Scorecard:**
- AC block 1 — Copy/format: PASS — Newsreader italic numerals, Manrope tails, textPrimary/textSecondary, literal middle dot, lowercase, no accent; both full (profile) and compact (VoicesStream) forms match shape-lock.
- AC block 2 — Thresholds: WARN — `K >= 5` and viewer/target insufficiency handled; **degenerate math renders MAE-fallback percentage rather than AC-173's "silent hide"** (defensible; explicitly overridden by Tech Design line 255 as architect discretion).
- AC block 3 — Surface A (profile header): PASS — row placed below bio, above stats; gated on `relationship === 'public_only'` per Architect Q3; "rate more" prompt on viewer insufficiency; not tappable. Minor WARN: empty-`View` wrapper leaves residual `marginTop: Spacing.sm` gap when chip collapses to null.
- AC block 4 — Surface B (public voice row): WARN — compact `· NN% match` token rendered per Architect Q1 Option B reframe; suppressed for viewer-as-author; hidden on null. **But public `VoiceRow`s have no `onPress` at all — AC-142's "tap routes to `/entry-detail?viewAs=public`" is not implemented post-reframe.**
- AC block 5 — Matches-mine filter: PASS — copy, thresholds (70%/K≥5/≥3 qualifying), default OFF, client-side filter+sort (`match_pct DESC`, `created_at DESC`), `accessibilityRole="switch"`, `accessibilityState.checked`, no persistence.
- AC block 6 — Overlap math rules: PASS — viewer side unfiltered (all privacy levels count); target filtered to `account_privacy='public' AND visibility <> 'private'`; silent ratings NOT rejected (no `char_length >= 20` constraint); Tablemate exclusion at both caller (`restaurant-history` pre-filter; `user-profile` skip for `public_and_tables`) and helper (defense-in-depth `table_members` self-join).
- AC block 7 — Privacy: PASS — `viewer_id` always from `supabase.auth.getUser(token)`; response shape is only `{ match_pct, mae, overlap_n, fallback }`; no per-restaurant breakdown ever leaves the server; Tablemate targets return null from the helper.
- AC block 8 — Edge cases: WARN — viewer 0 entries → prompt (good); target 0 entries → hidden (good); degenerate math → 100% via MAE fallback (contradicts AC-173, defensible per Tech Design); privacy-flipped viewer still sees chips (good). **But the Tablemate-exclusion query fires even when `target_ids` is empty-after-self-filter — wasteful when viewer is the only target, though not incorrect.**
- AC block 9 — Accessibility: PASS — screen-reader labels match AC copy verbatim; filter pill is switch-role; monochrome chip — no color-only meaning (pill's color-coded state is augmented by accessibilityState).

**FAIL items:**
1. **`supabase/functions/_shared/calibration.ts:207-213` — `profiles!inner(account_privacy)` relationship is not resolvable by PostgREST.** `entries.user_id` references `auth.users.id` (migration `20251215145100:34`); `profiles.user_id` also references `auth.users.id` (migration `20251201113055:347`). There is no direct FK from `entries` to `profiles`, and PostgREST does not auto-infer synthetic relationships across two tables that both reference the same parent. This means the fallback path — the path always invoked, since the `compute_calibration_batch` RPC does not exist per Q2 — will almost certainly receive a `relationship not found` error from PostgREST, the `te` branch (line 215) fires, and every target resolves to `null`. Calibration will silently not work in production. There is also zero test coverage exercising the calibration join (`user-profile/index.test.ts` contains no calibration cases). **Fix:** Split into two queries — first fetch target entries, then fetch `profiles.account_privacy` by `user_id` in a separate `.in('user_id', [target_id])` lookup. Or: add an explicit FK from `entries.user_id` to `profiles.user_id`. Or: deploy the `compute_calibration_batch` RPC migration so the primary path actually runs. Before merge, smoke-test a public-to-public viewer pair on a local Supabase instance and confirm a non-null `calibration` is returned.

**WARN items:**
1. `supabase/functions/_shared/calibration.ts:303-309` — Degenerate-math MAE fallback renders a 100% match when MAE=0 on a flat-rater pair. AC-173 demands silent hide; Tech Design line 255 explicitly sanctions this fallback as architect discretion. Defensible, but the mismatch between AC and Tech Design should be noted in the v1.1 empirical-tuning cycle.
2. `napkin-app/components/restaurants/VoicesStream.tsx:281-293` — `VoiceRow` rendered for `kind='public'` is passed no `onPress`, so the row is not tappable. AC-142's "tap routes to `/entry-detail?viewAs=public`" is silently dropped after the Q1 reframe. If product wants calibrated public rows to be drillable, route `pub-${r.entry_id}` taps to `/entry-detail?entryId=X&viewAs=public`. If not, AC-142 should be explicitly retired.
3. `napkin-app/components/profile/ProfileHeader.tsx:127-136` — The `<View style={styles.calibrationRow}>` wraps the chip/prompt with `marginTop: Spacing.sm`. When the child collapses to `null` (calibration returned null, viewer has >=5 entries, relationship is `public_only`), the outer `View` still contributes its top margin. This creates a small vertical gap. AC-119 says "the row collapses" — consider rendering the row only when a child will be shown (e.g. `calibration != null || viewerRatedEntryCount < 5`).
4. `supabase/functions/_shared/calibration.ts:194-199` — Viewer's rated entries are re-fetched inside the per-target for-loop; viewer entries don't vary per target. Hoist the viewer-side SELECT outside the loop. Not a correctness issue at N≤20 but wasteful latency.
5. `supabase/functions/_shared/calibration.ts:162 vs 271` — `computeCalibrationFromRow` receives `min_overlap` (from opts) on the RPC path but hardcodes `OVERLAP_MIN` on the fallback path. The `opts.min_overlap` override is silently ignored in fallback. No caller passes opts in v1, but correctness diverges when someone does.

**Notes for orchestrator:** Backend math + wiring is mostly clean and the Q1 Option B VoicesStream integration reads well. The core correctness concern is the `profiles!inner` join in the fallback calibration SQL (FAIL item 1) — since no RPC migration exists and no tests cover the calibration path, this feature probably ships dark. Fix by splitting the target-privacy fetch into a second query (cheap) or adding the RPC migration (preferred long-term). The MAE-fallback AC-173 conflict is a known architect override and fine to ship. Two cosmetic cleanups (Surface-B tap routing, empty-row margin) should be addressed if the design wants parity with the original AC, but neither is load-bearing. Do not merge until FAIL item 1 is fixed and at least one smoke test confirms calibration returns non-null for a real public-to-public pair.

### Review 2 (2026-04-23)
**Verdict:** APPROVE

**Re-scored items:**
- FAIL 1 (PostgREST join) — PASS. `_shared/calibration.ts:192-294` replaces the synthetic join with three `.in()` queries (viewer entries, `profiles.account_privacy`, target entries) and buckets pairs in Deno. `.neq('visibility','private')` preserved on target side; silent ratings still count.
- WARN 2 (public row tap) — PASS. `app/restaurant/[id].tsx:238-240` defines `handlePublicReviewPress` routing to `/entry-detail?entryId=X&viewAs=public`; wired at line 470 via `VoicesStream.onPublicReviewPress` → `VoiceRow.onPress` (`VoicesStream.tsx:294`).
- WARN 3 (empty row margin) — PASS. `ProfileHeader.tsx:127-142` gates the entire wrapper `View` behind `showPrompt || showChip`; no phantom margin when both would be null.
- WARN 4 (viewer hoist) — PASS. Viewer entries fetched once at `calibration.ts:201-216` before the per-target bucket loop.
- WARN 5 (`min_overlap` threaded) — PASS. Orchestrator threads `min_overlap` through `runBatchCalibrationSQL(…, min_overlap)` (line 151) → `computeCalibrationFromRow(…, min_overlap)` (line 290); RPC and fallback paths now honor `opts`.

**No new issues surfaced.** Pair-bucket math cross-checked; Tablemate defense-in-depth still fires at helper layer (lines 92-116); privacy filter (`account_privacy='public'` + `visibility<>'private'`) preserved across the split. Clean to merge.

---

## Completion

**Completed:** 2026-04-23
**Verdict:** APPROVE (Review 2).
**Cycles:** 2 review cycles. Review 1 flagged one production-breaking FAIL (PostgREST synthetic join across entries↔profiles) + 5 WARNs; fixes applied; Review 2 approved with no new issues.
**Follow-ups filed for future work:**
- AC line 128 wording is inconsistent with AC line 164 and UX Decision line 198 — should be corrected to `viewer_target_relationship === 'public_only'`.
- `compute_calibration_batch` Postgres RPC (single-round-trip path) deferred per architect Q2; land when `restaurant-history` p50 crosses 250ms in production.
- MAE-fallback degenerate case (AC-173 calls for silent hide; Tech Design line 255 sanctions the fallback) — revisit once production density allows empirical tuning.
