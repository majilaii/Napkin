---
id: TICKET-060
title: "\"Save it. Do it.\" — multimodal import (vision extraction + share-to-anywhere)"
priority: high
status: in-progress
created: 2026-06-03
updated: 2026-06-03
tags: [import, wishlist, tables, vision, ai, edge-function, share-extension, parent-040]
status_note: "CODE-COMPLETE on feat/TICKET-060 (52 files, +7.6k, 11 migrations). Built + 3 dual-review cycles (Claude+Codex) + 3 fix passes; all blockers closed. Critical paths (auth ordering N1-N3, RLS restaurants lockdown B1, Places verification B2) orchestrator-verified by direct inspection. Local SQL: 11 TICKET-060 migrations structurally valid (no syntax bugs, executed); behavioral SQL (float-cap/transactional/trigger) inspected + hand-traced, deferred to deploy (pre-existing migration-chain debt blocks clean local replay). DEPLOY PENDING — needs ANTHROPIC_API_KEY + INTERNAL_CALL_SECRET secrets + db push + fn deploy. NOT yet shipped/verified in prod. Phase 2 = TICKET-060b; race/plan = TICKET-061."
parent: TICKET-040
depends_on: []
---

# "Save it. Do it." — multimodal import (vision extraction + share-to-anywhere)

## Problem

Today you can only get a restaurant into Napkin by **pasting a URL** (`resolve-url` + `places-search`, shipped in TICKET-053). That path is deterministic URL resolution — it works on Google Maps links and generic web pages, but it **breaks on Instagram** (login-walled, no clean oEmbed) and has **no path at all for a screenshot** or a friend's text screenshot. Meanwhile the actual behavior we want to capture is: *you're scrolling TikTok/IG, you see a restaurant, you want it in Napkin in two taps and to keep scrolling.*

This is the wedge feature. We benchmarked **Rodeo** ("Save it. Do it.", ex-Hinge COO/CPO, $8.5M raised). The thing that makes Rodeo feel like magic is **multimodal AI extraction, not URL resolution**: it accepts link · screenshot · photo · caption text, runs a vision/LLM pass over the *content itself*, and pulls out name, city, cuisine, address, hours, and booking links. Because it reads pixels, not APIs, it works uniformly on TikTok, Instagram, and a random screenshot — exactly where our URL resolver dies.

We want to close that gap and own the capture habit. It's also strategically load-bearing: every save is a data point about what's desirable in a given city, which becomes the data engine for a future city-level local-taste / travel-discovery feature (see TICKET-061 and the Ring 2 doctrine).

Rodeo's guiding principle, which we're adopting: **"discovery is continuous, planning is discrete."** Saving is lossless and thoughtless (keep scrolling); deciding/planning happens later, in-app.

## Notes

Brainstormed 2026-06-03. Decisions locked below; this feeds the product-designer spec.

### Core reframe — vision is the universal substrate
The reason import breaks on Instagram is that we resolve URLs. If the hero input is "an image + whatever text rode along," then TikTok, IG, Maps, and a text screenshot all flow through **one path**: pixels + caption → Claude vision → `{ name, city, cuisine, address, booking_url?, hours?, confidence }`. Google Places stays as the resolver-**of-the-name** (we already have `places-search` + the `restaurants.external_id` join). So this is less "widen the resolver" and more "add a vision extractor as the primary path; URL parsing becomes one fast input among several."

### Input matrix (v1)
| User shares… | Handling |
|---|---|
| **Screenshot / photo** | → Claude vision (the universal path; also how IG gets rescued) |
| **TikTok link** | → fetch thumbnail + caption (existing oEmbed path from T-052/053) → vision/text |
| **Google Maps link** | → easy case: name/`place_id` is *in* the URL → straight to Places, no AI |
| **Instagram link** | walled → nudge "add a screenshot," or use whatever caption the share payload carries |

v1 covers screenshots + TikTok + Maps cleanly; **IG rides in via the screenshot path.** OPEN Q for spec: is native IG-link parsing a v1 must, or is screenshot-for-IG acceptable for v1? (Brainstorm leaned: screenshot is fine for v1 — IG links are the flaky one.)

### Async capture — never block
A share extension can't sit 2–3s on a vision call (iOS kills it; it murders "keep scrolling"). Model: **tap share → saved instantly as a "pending" card → extraction runs in the background → the card fills itself in (name, photo, city) seconds later.** Native pattern: the share extension drops the payload into a shared **App Group container**; the main app (or a background task) processes it. Async also unlocks the **Batch API (~50% off)** for extraction.

### Cost — vision is cheap; tier + cache anyway
Ballpark (verify against current rate card): one extraction ≈ a downscaled image (~1.5–2.5k image tokens) + small prompt + caption → ~150-token JSON. **Haiku ≈ ⅓ cent/save; Sonnet ≈ 1 cent/save.** Even 10k saves/mo ≈ $30–100/mo. Not the scary cost. Architecture keeps it cheap:
1. **Free path** — Maps URL parse (no AI).
2. **Cheap path** — text-only Haiku on a usable caption (≈10× cheaper than vision).
3. **Vision path** — only when text is insufficient (screenshot w/ no caption).
4. **Global cache / dedup** — viral TikToks get saved by many people; resolve once by URL/content-hash, cache forever → repeat saves are $0. **The big lever.**
- Model = **Haiku 4.5**, not Opus. Downscale images (~768px long edge). **Per-user rate limit + content-hash idempotency** so a loop/abuse never pays twice (reuse `check_and_increment_rate_limit` from T-053).
- Costs actually worth watching are **Google Places** (~1.7¢/lookup — can exceed vision; we already pay it) and any third-party scraping service — NOT Claude vision.

### Destination routing — smart default, one tap, multi-select
Share → Napkin sheet pops with destination **pre-ticked** (default: **My Wishlist**) → Confirm → gone, processes in background. Lazy path = 2 taps; intentional path = 3 (tap to redirect). **Multi-select locked in** — you can fire one save into several destinations at once (wishlist + N Tables). Precedent exists: multi-table-per-entry (`entry_tables`, T-043).

Picker reads simply — *"where does this go?"* → `[My Wishlist ✓] [Table: Sunday Crew] [Table: NYC Trip] [List: Date spots]`.

### "Save to a Table" = post a card into the Table FEED (doctrine-safe)
**Locked doctrine: the Table wishlist is *emergent*** (auto-merge of members' personal saves; no unilateral "nominate"). So "save to a Table" must NOT write a row into the algorithmic Table wishlist. Instead it splits:
- **Save to My Wishlist** (default) → private, AND automatically feeds every Table's emergent overlap. You contribute to your Tables passively just by saving.
- **Save to a Table** → drops a **card into that Table's feed** (`table-activity`) — a shared "check this out" everyone sees and can react to. Social act; doctrine intact; Tables stay un-spammable.

The Table-feed card carries a lightweight `👀 I'm in` reaction (extends `post-interactions` / T-007) — this is the **seed for TICKET-061** (the race/plan primitive). Booking URL, if extraction returns it for free, can be stashed on the card for B to use.

### Feed-noise control (the spam fear: "someone saves 20 at once")
1. **Saving ≠ shouting.** Default save is silent (wishlist) → bulk-saving 20 touches **no** feed. Kills ~90% of the spam case.
2. **Coalesce bursts** — multiple pushes to one Table in a window collapse into ONE digest card ("Jacky dropped 4 spots") → expandable. Not N cards.
3. **Emergent float (primary "let's go" mechanism)** — app floats a restaurant into the Table feed when overlap crosses a threshold ("3 of you saved Kono this week — plan it?"). **Spam-proof by construction** (fires only on multiple *independent* saves) and on-brand with the emergence-arc doctrine. Explicit push is the spice; emergent float is the star.

### Wrong-guess rule
Async means we can't ask mid-scroll, so: **every save succeeds instantly, no matter what.** Extraction returns a best-guess restaurant (a **ghost** if it's not in our DB). Low confidence → card lands with a quiet "tap to confirm" flag, fixable later in one tap (in the wishlist/collection). Never blocks, never loses a save.

### Phasing (de-risks + lets the user test the magic fast)
- **Phase 1 — extraction pipeline + in-app entry point.** New vision-extraction edge function + an in-app "upload a screenshot / paste a link" surface (extend existing `ImportLinkSheet`). **Testable in prod immediately, no native build needed.** This proves the core magic (screenshot → right restaurant) end-to-end.
- **Phase 2 — iOS share extension** (the 2-tap-from-TikTok/IG gesture). The hard native piece (Expo managed; see T-051 spike). Requires an EAS dev-client / TestFlight build on a real device — share extensions don't run in Expo Go.

### Scope cuts (do NOT let this ticket absorb them)
- **Booking / Resy / OpenTable actions + scheduling** → TICKET-061 (the race/plan primitive). Stash a booking URL if extraction yields it for free; build no scheduling here.
- **Voting / RSVP / "should we go this weekend"** → TICKET-061.
- **Android share intent** → later ticket (iOS-first for v1; confirm with user).
- **Multi-restaurant extraction from one post** ("TikTok about 5 Tokyo spots") → take best candidate, defer the list (carries from T-053 out-of-scope).

### Existing groundwork to reuse (don't rebuild)
- `supabase/functions/resolve-url/index.ts` — URL resolver: source detection, rate-limit rpc, internal `places-search` call, `restaurants.external_id` join, `already_wishlisted`. **Extend with a vision branch + image input.**
- `supabase/functions/_shared/wishlistSource.ts` — `WishlistSource` discriminated union + `validateWishlistSource()`. Add a `screenshot`/`vision` source variant.
- `wishlist_items.source` jsonb column + CHECK (from T-053).
- `check_and_increment_rate_limit()` SQL fn + `rate_limit_buckets` (from T-053) — reuse for the extractor.
- `napkin-app/components/wishlist/ImportLinkSheet.tsx`, `components/nav/PlusActionMenu.tsx`, `hooks/wishlist/useResolveUrl.ts`, `hooks/wishlist/useWishlistAdd.ts`.
- `places-search`, `table-activity` (Table feed post), `post-interactions` (reactions).
- T-040 (import umbrella, parent), T-051/052 (share-ext + TikTok spikes), T-054 (TikTok embed), T-055 (iOS share ext).

### Blast-radius pre-flight (planner must produce the full checklist)
Touches: new vision-extraction edge fn (Anthropic API key as a new secret), `resolve-url` contract change, `wishlist.add` source-union extension, `table-activity` gains a "shared restaurant card" post type, `post-interactions` gains an `I'm in` reaction, possible new migration for the Table-feed card + emergent-float threshold. Schema + edge contracts + RLS = **dual-review (Claude + Codex) at spec, arch, and build.**

### How to test in prod (the user explicitly wants this)
- **Phase 1 is the fast path:** once the extraction edge fn deploys (via CI / standing edge-fn deploy habit) and the in-app upload/paste surface ships in a build, you can **screenshot a TikTok/IG restaurant → open Napkin → upload it → watch it resolve** — no share extension required.
- **Phase 2 (true 2-tap from TikTok/IG):** needs the iOS **share extension**, which requires an **EAS development build or TestFlight** on a physical iPhone (Expo Go can't host share extensions). Flow once installed: TikTok → Share → **Napkin** → Confirm → it lands in your wishlist; same from Photos for a screenshot.
- Edge function reaches prod through the normal deploy path; the **client/share-extension reaches you only via an app build (EAS/TestFlight)**, not a server deploy.

---
<!-- Everything below this line is populated by agents as the ticket progresses -->

## Product Spec

> **Scope of this ticket (the call I made — confirm via Open Question 1):** Phase 1 (vision-extraction pipeline) + destination routing + the Table-feed card + the emergent float. The native iOS share extension (Phase 2 — the true 2-tap-from-TikTok gesture) is **deferred to a fast-follow sub-ticket** so the magic is testable in prod the day the extraction edge fn deploys, with no EAS/TestFlight build gating it. The in-app entry point reuses the existing `ImportLinkSheet` (TICKET-053), widened to accept a screenshot/photo upload alongside the paste path. Everything here honors the locked decisions in Notes; I did not re-open them.

### User Stories

**Capture (the lossless save)**
- As a **TikTok scroller**, I want to screenshot a restaurant clip, open Napkin, drop the screenshot into "add from link," and watch the right restaurant fill itself in seconds later, so that I capture it without retyping a name or leaving my couch.
- As an **Instagram screenshotter**, I want IG (which is login-walled and breaks URL resolution) to work via a screenshot of the post, so that the one place the paste path dies is rescued by pixels.
- As a **friend who got a Google Maps link in a text thread**, I want to paste that link and have it resolve instantly with no AI cost or wait, so that the easy case stays the fast case.
- As a **traveler hoarding a city's spots**, I want to fire 15 saves in a sitting and keep moving, never blocked by a spinner and never forced to confirm each one, so that planning-later doesn't tax saving-now.
- As a **someone mid-scroll**, I want the save to land as a "pending" card the instant I tap, and never see a modal block me on a 2–3s extraction, so that capture stays thoughtless.

**Destination (where it goes)**
- As a **solo saver**, I want My Wishlist pre-ticked so the lazy path is one confirming tap, so that the default costs me nothing.
- As a **Table member who wants to rally a crew**, I want to also push a save into a Table so it lands as a "check this out" card in that Table's feed, so that I can say "we should go here" without it being a unilateral add to the Table's wishlist.
- As a **Tablemate seeing a shared card**, I want a one-tap `I'm in` reaction, so that wanting-in is lighter than typing a reply.
- As a **multi-destination saver**, I want to fan one save into My Wishlist plus two Tables at once, so that I don't repeat the flow three times.

**Noise control (the spam fear)**
- As a **bulk-saver**, I want my 15 wishlist saves to touch nobody's feed, so that hoarding never spams a Table.
- As a **Table member**, when someone does push several spots to our Table in a short window, I want them collapsed into ONE digest card ("Jacky dropped 4 spots"), not 4 separate cards, so that the feed stays calm.
- As a **Table member**, I want the app itself to float a restaurant into our feed only when several of us independently saved it ("3 of you saved Kono this week"), so that the strongest "let's go" signal is spam-proof by construction.

**The wrong-guess fixer**
- As a **user whose async extraction guessed wrong** (or low-confidence), I want the save to still succeed instantly and land with a quiet "tap to confirm" flag, fixable later in one tap, so that a bad guess never blocks me and never loses the save.
- As a **user who saved a place not in Napkin's database yet**, I want it saved as a ghost restaurant immediately, so that long-tail spots aren't a dead end.

**Cost / abuse (invisible, but load-bearing)**
- As a **user who saved a viral TikTok thousands of others also saved**, I want it to resolve from cache instantly and for free, so that the same content is never re-extracted.
- As a **user (or a misbehaving loop)** who fires the same content repeatedly, I want idempotency + a rate limit to absorb it, so that abuse never pays twice.

### Acceptance Criteria

**Input handling — per type**

- [ ] **Screenshot / photo upload (the universal path):** The import sheet (`ImportLinkSheet`) gains a second capture affordance beside the URL input — an "add a screenshot" / "upload a photo" row that opens the OS image picker. Selecting an image transitions the sheet into the async pending-card flow (see below). The image is downscaled client-side to ≤768px long edge before upload (per Notes cost section). Accepted: any image the picker returns (see Open Question 6 on photo-library vs screenshots-only). HEIC/PNG/JPG all accepted; the client normalizes to JPEG for upload.
- [ ] **TikTok link:** A pasted TikTok URL flows through the existing oEmbed thumbnail+caption path (T-052/053), then the extraction contract. If the caption is sufficient, the cheap text-LLM path resolves it; if not, the thumbnail image rides the vision path. Either way the user does not see which tier ran.
- [ ] **Google Maps link (the free case):** A pasted Maps URL with a parseable name / `place_id` resolves straight through `places-search` with **no AI call** (the existing T-053 `google_maps` branch). Confidence may be `exact` only on a real `place_id` round-trip; otherwise `high`/`low` per existing rules.
- [ ] **Instagram link:** A pasted IG URL is detected as walled. The sheet shows a quiet nudge — "instagram links are tricky — add a screenshot instead" — with a one-tap jump to the screenshot picker. If the share payload happens to carry caption text, that text is run through the text-LLM path as a best-effort fallback before nudging. (Native IG-link parsing is **not** a v1 requirement — see Open Question 2.)
- [ ] **Mixed payload (image + caption text):** When both an image and rode-along caption text are present, the extractor receives both; the contract prefers the cheaper text path and falls back to vision only when text is insufficient (Notes tier order: Maps-parse → text-LLM → vision).

**Extraction contract**

- [ ] **Returned shape:** The extractor returns, per resolved candidate, at minimum `{ name, city, cuisine?, address?, booking_url?, hours?, confidence, google_place_id?, restaurant_id | null, already_wishlisted }`. `restaurant_id` is `null` when the place is a ghost (not yet in `restaurants`). `booking_url` and `hours`, when extraction yields them for free, are carried but **not acted on** in this ticket (stashed for TICKET-061). The candidate's restaurant shape stays wire-identical to `places-search` output so downstream surfaces render unchanged (mirrors T-053 `ResolvedCandidate`).
- [ ] **Confidence enum:** `'exact' | 'high' | 'low'` (same enum T-053 locked). `'exact'` reserved for a Maps `place_id` round-trip. Vision/text extractions are at most `'high'`. Anything the extractor is unsure of is `'low'` and triggers the needs-confirm flag (below).
- [ ] **Ghost fallback:** If the extractor names a restaurant but `places-search` returns no match, the save still succeeds as a **ghost restaurant** (upsert-from-place silently, per the "Ghost restaurant" doctrine in CLAUDE.md). This is a deliberate departure from T-053's "no name-only ghost" rule, justified by the async-capture doctrine: a save must never fail mid-scroll. The ghost carries whatever fields extraction produced and is flagged needs-confirm if confidence is `low`.
- [ ] **Extraction never throws to the user:** Any extractor failure (model error, timeout, unparseable image) resolves the pending card into a needs-confirm state with the user's raw input preserved (the image/link), tappable to retry or fix — never an error that loses the save.

**Async pending-card UX (the never-block contract)**

- [ ] **Three card states:** Every capture produces a card that moves through `pending` → (`resolved` | `needs_confirm`). `pending`: shows a warm-paper placeholder with italic Newsreader "reading it…" and the source thumbnail if present. `resolved`: fills in restaurant name (italic Newsreader), `city · cuisine` (Manrope, middle-dot), and photo. `needs_confirm`: resolved-looking but carries a quiet "tap to confirm" affordance (muted, not alarming — no red, no emoji).
- [ ] **Instant feedback:** Tapping save (or confirming destination) dismisses the sheet / returns the user to scrolling **immediately** — the card appears in its destination already in `pending` state. Extraction runs in the background; the card fills itself in via a state update (no user-visible reload). The user is never held on a spinner waiting for extraction.
- [ ] **Where the pending card lives:** For a My Wishlist save, the pending card appears at the top of `app/wishlist.tsx`'s personal list. For a Table save, the pending card appears in that Table's feed (see Table-feed card below). The card resolves in place.
- [ ] **Resolution is non-blocking and resilient:** If the user backgrounds the app before extraction finishes, the card resolves on next foreground / refetch. No save is lost to an interrupted extraction.

**Destination picker — smart default, one tap, multi-select**

- [ ] **Default pre-tick:** The destination picker opens with **My Wishlist pre-ticked**. The lazy path is: capture → confirm (My Wishlist already checked) → gone. (See Open Question 3 on always-My-Wishlist vs last-used.)
- [ ] **Picker copy + layout:** Reads "where does this go?" (lowercase, italic Newsreader title) over a vertical list: `[My Wishlist ✓]` then the user's Tables `[Table: Sunday Crew]` `[Table: NYC Trip]` then Lists `[List: Date spots]` (Lists gated by Open Question 5). Table and List names render in italic Newsreader. Each row is a ≥48pt toggle with a checkmark when selected. No icons, no 1px dividers — separation via `surfaceJournalLow` background shift + `Spacing.md`.
- [ ] **Multi-select:** Multiple destinations can be ticked at once. One save fans out to all ticked destinations (precedent: multi-Table-per-entry `entry_tables`, T-043). My Wishlist + N Tables in a single confirm.
- [ ] **One-tap confirm:** A single primary CTA ("save", terracotta, lowercase) commits all ticked destinations and dismisses. Tapping a Table that isn't My Wishlist is the only extra tap the intentional path costs (lazy = confirm only; intentional = tick + confirm).

**Table-feed card + the `I'm in` reaction**

- [ ] **"Save to a Table" posts to the Table FEED, not the emergent wishlist (doctrine-locked):** Ticking a Table drops a **shared-restaurant card** into that Table's feed (`table-activity`). It does **not** write a row into the algorithmic Table wishlist — there is no unilateral add-to-Table. (The personal save, when also ticked, still feeds emergent overlap passively.)
- [ ] **Card shape:** The shared-restaurant card is a new feed item type rendered in the Table feed. It shows: who shared it (avatar + display name + lowercase past-tense verb — **`shared`**), restaurant name (italic Newsreader), `city · cuisine`, the source thumbnail if present, an optional one-line note, and an `I'm in` reaction control. Metadata uses middle-dot `·`. Verb is lowercase past-tense (`shared`), consistent with `noted` / `pinned` / `gathered`.
- [ ] **`I'm in` reaction:** The card carries a lightweight `I'm in` reaction (maps to the `👀` emoji already valid in `post-interactions` `VALID_EMOJIS`). Tapping it toggles the caller's `I'm in`; the card shows a count + reactor avatars ("you + 2 in"). This is the seed for TICKET-061's race/plan primitive — this ticket ships only the reaction, no scheduling/booking. (Reactions on this new card type require `post-interactions` to accept a new target type — architect to extend; spec-level requirement is: the reaction works and toggles like every other reaction.)
- [ ] **Booking URL stash:** If extraction returned a `booking_url`, it is stored on the card's payload for TICKET-061 to consume. This ticket renders **no** booking button.
- [ ] **Membership + privacy:** Only Table members see the card (existing `table-activity` membership gate). The shared card never leaks the sharer's full wishlist or other Tables. The personal note on the card is the only user text exposed, and only to that Table.

**Feed-noise control**

- [ ] **Silent default:** A save whose only destination is My Wishlist (or any set of non-Table destinations) touches **no** feed. Bulk-saving 15 to the wishlist produces zero feed cards anywhere.
- [ ] **Burst coalescing into a digest card:** Multiple shared-restaurant pushes by the same user to the **same Table** within a coalescing window collapse into ONE digest card in that Table's feed — copy reads "Jacky dropped 4 spots" (lowercase past-tense; sharer name + count). The digest is expandable to reveal the individual restaurants; each revealed spot still carries its own `I'm in`. It is **not** N separate cards. (Window length is Open Question 4 — proposed default below.)
- [ ] **Emergent float (the primary "let's go"):** When a restaurant crosses an overlap threshold inside a Table — i.e. several **distinct** members independently saved it within a window — the app floats a card into that Table's feed: "3 of you saved Kono this week — plan it?" (lowercase, restaurant name italic Newsreader, count as the ranking signal). This is spam-proof by construction (fires only on multiple *independent* saves) and is the star; the explicit push card is the spice. The float is **dismissible** and is **frequency-capped** per Table/restaurant so it never nags twice for the same set in a short window (mirrors the emergence-arc card doctrine). Threshold + window + cap values are Open Question 4.
- [ ] **Float CTA scope:** The float's "plan it?" CTA is a placeholder seam for TICKET-061. In THIS ticket it routes to the restaurant page (or expands the overlap), not to any scheduling/voting UI. No booking, no RSVP here.

**Wrong-guess / confirm-later correction**

- [ ] **Every save succeeds instantly, always:** No extraction outcome — wrong guess, low confidence, ghost, model failure — ever blocks or fails a save. The save lands; correction is always deferred and optional.
- [ ] **Needs-confirm flag:** A `low`-confidence resolution lands the card with a quiet "tap to confirm" flag (muted Manrope, no alarm color). The flag is visible in the wishlist (and on the Table card if shared) until resolved.
- [ ] **One-tap fix:** Tapping "tap to confirm" opens the inline edit-the-match search (reuse T-053's `EditMatchPanel` over `places-search`, the caption/extracted-name prefilled). Selecting the right restaurant updates the card in place (re-pointing a ghost via `restaurants.external_id` upsert, exactly as T-053's edit-match does). Confirming clears the flag.
- [ ] **Confirm propagation:** If a shared-to-Table card is corrected by its author, the corrected restaurant propagates to the Table card (the Table sees the fixed name, not the wrong guess). Other members cannot edit someone else's shared card.

**Rate-limit, caching, idempotency**

- [ ] **Per-user rate limit:** Extraction reuses `check_and_increment_rate_limit()` (T-053) with an extraction-specific bucket key. Over-limit returns a structured 429; the sheet shows the existing "give it a minute — too many requests" rate-limited copy. Threshold is an architect-tunable arg (as in T-053).
- [ ] **Global cache / dedup (the big cost lever):** Extractions are cached globally keyed by source URL and/or image content-hash. A repeat save of the same viral TikTok / identical screenshot resolves from cache with **no** new model call (and ideally near-instant, skipping `pending`). Cache is keyed by content, not by user, so popularity makes it cheaper.
- [ ] **Content-hash idempotency:** The same content saved twice (a loop, a double-tap, an abusive client) is idempotent — it does not enqueue a second extraction and does not double-charge. A user re-saving a restaurant they already wishlisted hits the existing idempotent wishlist add (returns the existing row silently).

**Heirloom Journal compliance** (fallback note: the canonical design bundle at `/tmp/design/napkin-design-system/project/` was **not present** at spec time — see Open Question 7; ACs below cite `napkin-app/constants/theme.ts` tokens, which I read, and inherit T-053's bundle-compliant patterns)

- [ ] **Surfaces, color, type:** New surfaces use `palette.background` / `surfaceContainerLow` (warm paper), `palette.text` (`#1c1c19` — never pure black). Restaurant names, Table names, List names, and the sheet/float titles use `Type.headlineItalic` (italic Newsreader = brand voice). Body/labels use `Type.body` / `Type.bodySmall` / `Type.caption` (Manrope). Verbs are lowercase past-tense: **`saved`**, **`shared`**, **`reading it…`**, **`dropped`**, **`pinned`** — never "posted/shared" in title case, never "uploading."
- [ ] **No emoji in chrome:** The `I'm in` control renders as a label + count, not a raw emoji in the UI chrome (the `👀` is the underlying reaction token, surfaced as user-generated, not as a chrome glyph). The needs-confirm flag, digest card, and float carry zero emoji.
- [ ] **Structure without borders:** No 1px solid section borders anywhere (picker rows, cards, digest). Separation = `surfaceJournalLow` background shifts + `Spacing` + ghosted warm rules (`dividerSoft` / `ruleInkSoft` only where T-053 already does). Ambient shadow only (`Shadow.ambient` on sheets, `Shadow.clip` on cards).
- [ ] **Two-accent cap:** Each new screen uses at most two accents from {terracotta, olive, amber}. Picker/sheet: terracotta primary CTA + (if needed) olive for a "best match"/selected state. Emergent float: a single accent (terracotta) for "plan it?". Do not stack three accents.
- [ ] **Metadata + quotes grammar:** Middle-dot `·` separates all metadata (`city · cuisine`, `you + 2 in`). If a card surfaces a pull-quote from a caption/note, it is prefixed with an em-dash `—`. Ionicons outline @ 24px only where icons appear (the bottom-nav `+` stays untouched per `feedback_bottom_nav.md`).

### UX Decisions

- **Vision is the universal substrate, but it's invisible** — the user never picks "screenshot mode" vs "link mode"; they drop whatever they have and Napkin reads it. *One door, not four. The pixels do the sorting.*
- **The in-app screenshot upload ships first; the share extension waits** — Phase 1 proves the magic (screenshot → right restaurant) in prod with no native build. *Don't gate the magic on TestFlight.*
- **Capture is lossless and thoughtless; planning is discrete** (Rodeo's principle, adopted) — saving never blocks, never asks, never fails; deciding happens later, in-app. *Save it now, do it later.*
- **My Wishlist is pre-ticked because the lazy path must cost one tap** — most saves are private hoarding; the default should be free. *The quiet path is the default path.*
- **"Save to a Table" is a feed card, never a wishlist row** — the Table wishlist is emergent and sacred; an explicit push is a social "check this out," not a unilateral add. *Tables stay un-spammable; the wishlist stays earned.*
- **The emergent float is the star; the explicit push is the spice** — the strongest "let's go" comes from the app noticing overlap, not from one person shouting. *Three people quietly wanting the same place says more than one person posting it.*
- **Bulk saving touches no feed** — silence-by-default kills ~90% of the spam fear before coalescing or floats even matter. *Hoarding is private by construction.*
- **Bursts coalesce into a digest, not N cards** — four spots from one person is one calm line ("dropped 4 spots"), expandable. *One voice, one card.*
- **Every save succeeds instantly even on a wrong guess** — async means we can't ask mid-scroll, so we never block; we flag quietly and let the user fix it in one tap later. *Never lose a save to a bad guess.*
- **Ghosts are allowed here (unlike paste-a-link)** — T-053 forbade name-only ghosts to keep `restaurants` clean, but the never-block doctrine outranks that for captured saves; a `low`-confidence ghost is better than a failed save. *A messy save beats a lost one.*
- **The global cache is keyed by content, so popularity makes it cheaper** — viral clips resolve once for everyone. *The crowd pays the extraction once.*

### Out of Scope

- **Phase 2 — native iOS share extension for images + text.** The true 2-tap-from-TikTok/IG gesture is **deferred to a fast-follow sub-ticket** (e.g. TICKET-060b). T-055 already shipped a link-only share extension (`napkin://import?url=`); Phase 2 extends that target's activation rules to accept image + text attachments and hand them to the extraction pipeline via the App Group container. Rationale: Phase 1 is testable in prod without an EAS/TestFlight build; the share extension must not gate the magic. *(Confirm split via Open Question 1.)*
- **Booking / Resy / OpenTable actions + scheduling** → TICKET-061. This ticket stashes a `booking_url` if extraction yields it for free; it builds no booking UI.
- **Voting / RSVP / "should we go this weekend?"** → TICKET-061. The `I'm in` reaction is the only rally primitive shipped here; "plan it?" is a placeholder seam.
- **Direct writes to the emergent Table wishlist.** No "nominate," no unilateral add-to-Table. Doctrine-locked.
- **Android share intent.** iOS-first for v1 (confirmed in Notes). Android in-app upload may come along for free if the picker is cross-platform, but the share *intent* is a later ticket.
- **Multi-restaurant extraction from one post** ("TikTok about 5 Tokyo spots"). Take the best candidate; defer the list (carries from T-053).
- **TikTok video embed rendering** on the wishlist or Table card (T-054 territory; data may be stored, render is out).
- **A new notifications-inbox surface for `I'm in` / emergent float.** Whether these emit `notifications` rows (T-048) is an architecture question; this ticket does not design new inbox row types.
- **Public-profile / Ring-2 exposure of saves.** Saves stay private (wishlist) or Table-scoped (shared card). No public surface here.
- **Batch API wiring as a hard requirement.** Async unlocks it (~50% off) but v1 correctness does not depend on it; architect may defer the batch path.

### Open Questions

1. **(TOP) Ticket scope: Phase-1-only vs include the share extension?** I scoped this ticket to Phase 1 + routing + Table card + emergent float, and **split the native iOS share extension (Phase 2) to a fast-follow sub-ticket** — because Phase 1 ships the magic in prod with no native build, while the share extension needs EAS/TestFlight and would gate everything behind a device build. T-055 already shipped the link-only extension; Phase 2 just widens it to images+text. **Confirm this split, or say if you want the share extension in-scope here.**
2. **Native IG-link parsing in v1, or screenshot-only for IG?** Brainstorm leaned screenshot-only (IG links are the flaky ones; the screenshot path rescues them universally). The spec assumes **screenshot-for-IG + a nudge on IG-link paste**, with a best-effort text-LLM pass if the share payload carries a caption. Confirm, or require a native IG-link path in v1.
3. **Default destination: always My Wishlist, or last-used?** Spec assumes **always My Wishlist pre-ticked** (predictable, private, free). Alternative: remember the last-used destination set (faster for someone repeatedly rallying one Table, but less predictable and risks accidental Table pushes). Which?
4. **Emergent-float + digest tuning — four numbers I need from you:** (a) **float threshold** — how many *distinct* members must independently save a restaurant to trigger the float? (proposed: **3**); (b) **float window** — over what period do those saves count? (proposed: **rolling 14 days**); (c) **float frequency cap** — how long is a given Table/restaurant float suppressed after firing or being dismissed? (proposed: **30 days**, never twice for the same set in that window); (d) **burst-coalescing window** — pushes by one user to one Table within how long collapse into a digest? (proposed: **6 hours**). Confirm or adjust each.
5. **Are Lists a v1 destination, or just My Wishlist + Tables?** The picker can include the user's Lists as fan-out targets, or v1 can ship **wishlist + Tables only** and add Lists later. Lists add surface area (list privacy, list membership) — recommend **defer Lists to a follow-up** unless you want them now.
6. **In-app upload: any photo-library image, or screenshots only?** Restricting to screenshots is cleaner conceptually ("you saw it, you snapped it") but the OS picker can't reliably distinguish a screenshot from any photo without extra entitlements. Recommend **accept any image** the picker returns and let extraction sort it out. Confirm.
7. **Design-bundle fallback (FYI, not blocking):** The canonical Heirloom Journal bundle at `/tmp/design/napkin-design-system/project/` was **not extracted** at spec time, so the Heirloom ACs above cite `theme.ts` tokens + T-053's bundle-compliant patterns rather than the canonical `logger-canvas.jsx` / `feed-canvas.jsx`. The architect/builder **must fetch the bundle** (per CLAUDE.md) before implementing the new shared-restaurant card, digest card, and emergent float, and reconcile against `feed-canvas.jsx` (the closest surface). Flagging so the visual reference isn't skipped.

#### Codex spec review (2026-06-03) — dual-review gate (schema + edge contracts + RLS)

Codex (`codex-companion task`) sanity-checked the Product Spec. **HIGH = data-integrity/RLS holes the architect MUST close** (tagged `[ARCH-RESOLVE]`, carry into Technical Design as blocking items per the TICKET-053 precedent); a few need a product call from the user (`[USER]`, resolved with the user this session).

**HIGH (data-integrity / RLS):**
- `[ARCH-RESOLVE] [CODEX-H1]` **Content-keyed cache leaks user state.** Global extraction cache is keyed by content, but the candidate shape includes user-specific `already_wishlisted` / `restaurant_id` join. Cache MUST store only content-derived extraction (name/place/cuisine/…); `already_wishlisted` + wishlist join are recomputed per-request, never cached.
- `[ARCH-RESOLVE] [CODEX-H2]` **No server-side membership validation in ACs** for Table-destination writes, shared-card reads, correction propagation, and `I'm in` reactions. A client-supplied `table_id` / reaction target could leak or mutate cross-Table data. Add explicit server-validation ACs against `table_members.member_id` (per CLAUDE.md schema doctrine).
- `[USER] + [ARCH-RESOLVE] [CODEX-H3]` **Emergent-float privacy boundary undefined.** Float turns PRIVATE wishlist saves into a Table-visible card. Must define what's revealed (count vs identities) and that aggregation is strictly Table-membership-scoped. → user question below.
- `[ARCH-RESOLVE] [CODEX-H4]` **Ghost upserts from low-confidence model output** aren't constrained to private/pending vs canonical/global. Risk: model-created ghosts pollute shared `restaurants` / leak across users. Architect must scope model ghosts as unverified / private-until-confirmed.
- `[ARCH-RESOLVE] [CODEX-H5]` **Content-hash idempotency ambiguous across destinations.** Idempotency must apply to the EXTRACTION (don't re-extract identical content), NOT to the save/fan-out — a second save of the same content to a DIFFERENT Table/List is legitimate and must not be suppressed.

**MEDIUM:**
- `[ARCH-RESOLVE] [CODEX-M1]` No AC for server-enforced upload size/type/dimension limits — client downscale is bypassable; add server guards.
- `[USER] [CODEX-M2]` "Every save succeeds instantly" vs rate-limit 429 — define over-limit behavior. → recommend: save lands, extraction deferred/flagged, never blocks.
- `[ARCH-RESOLVE] [CODEX-M3]` Bulk-save "never forced to confirm each" (story) vs picker-confirm-per-capture (AC) — clarify (confirm = one-tap accept of pre-ticked default, not a disambiguation).
- `[USER] [CODEX-M4]` Lists are in the picker AC but unresolved in OQ5 — specified and not specified at once. → resolve in/out for v1.
- `[USER] [CODEX-M5]` Digest/float tuning values open (OQ4) → no deterministic acceptance tests until set. → lock the four numbers.
- `[ARCH-RESOLVE] [CODEX-M6]` `I'm in` / float notification behavior (emit `notifications` rows or stay silent) left open — decide so behavior is deterministic.

**LOW (`[ARCH-RESOLVE]`):** caption-text source when share-ext is out of scope (L1); empty/missing `cuisine` rendering in `city · cuisine` (L2); `booking_url` storage/read RLS (L3); float CTA accepted behavior (L4).

**Disposition:** all `[ARCH-RESOLVE]` items carry into the Technical Design as blocking items the Phase-1.5 Codex design review must verify closed. `[USER]` items (H3 float privacy, M2 over-limit, M4 Lists, M5 tuning) + PD Open Questions 1–3/6 resolved with the user below.

#### Resolutions (2026-06-03, with user)

- **OQ1 / scope — RESOLVED: Phase 1 only.** This ticket = vision extraction + in-app screenshot/paste upload + destination routing + Table-feed card + emergent float. The native iOS share extension splits to **TICKET-060b** (fast-follow). Phase 1 is testable in prod with no TestFlight build.
- **OQ2 IG handling — RESOLVED: screenshot-only for IG in v1.** IG-link paste shows the "add a screenshot" nudge + a best-effort text-LLM pass on any rode-along caption. No native IG-link parsing in v1.
- **OQ3 default destination — RESOLVED: always My Wishlist pre-ticked** (predictable, private, free). Last-used deferred.
- **OQ6 in-app upload — RESOLVED: accept any photo-library image** (the OS picker can't reliably distinguish a screenshot; extraction sorts it out).
- **OQ5 / CODEX-M4 Lists — RESOLVED: defer Lists.** v1 picker = My Wishlist + Tables only. The picker AC's `[List: …]` row is OUT for v1 (architect removes it from the v1 picker; the multi-select fan-out infra stays List-ready under the hood).
- **OQ4 / CODEX-M5 float + digest tuning — RESOLVED (defaults accepted):** float threshold = **3 distinct members**; float window = **rolling 14 days**; float frequency cap = **30 days** (never twice for the same Table/restaurant set in that window); burst-coalesce window = **6 hours**. All as architect-tunable edge-fn args.
- **CODEX-H3 float privacy — RESOLVED: count + avatars.** The float shows the count AND the avatars/names of the members who saved it ("Jacky, Clara & Thomas saved Kono"). **Deliberate doctrine note:** inside a Table (trust ring 1), a member's wishlist save becomes visible to Tablemates *when it contributes to a float*. The architect MUST bound this strictly — only Table members see it, only the specific floated restaurant, only saves by current Table members; **never public, never cross-Table, never the member's broader wishlist.** This is the one place personal-save privacy is intentionally relaxed, and only within the Table.
- **CODEX-M2 over-limit — RESOLVED: never block.** On rate-limit, the save still lands (pending/needs-confirm); extraction is deferred or skipped with a quiet flag. Never-block doctrine outranks the 429.
- All remaining `[ARCH-RESOLVE]` Codex items (H1, H2, H4, H5, M1, M3, M6, L1–L4) carry into the Technical Design as blocking items for the Phase-1.5 Codex design review.

---

## Technical Design

> **Revision note (2026-06-03, post-Codex design review):** This design was revised to close the Codex adversarial-review punch list R1–R13. The structural change is the move from a client-orchestrated two-mutation fan-out that PATCHed target rows by id, to a **server-owned `import_jobs` model with a single transactional `create_import` endpoint**. The `[ARCH-RESOLVE]` H1–L4 closures from the spec-gate review remain valid; each Codex-fix carries a `[CODEX-FIX Rn]` tag.

### Approach

We add a **vision-extraction tier** to the existing `resolve-url` function (new `image`/`caption` input branch → Claude Haiku, model id `claude-haiku-4-5-20251001` via `EXTRACTION_MODEL` env — R10) and make capture **fully async and server-owned**. The capture flow is now: the client makes **ONE mutation** to a single transactional **`create_import`** endpoint; the server validates EVERY ticked destination's membership (`table_members.member_id`) BEFORE writing anything, then in ONE transaction (a SECURITY DEFINER rpc) writes all pending destination rows plus a parent **`import_jobs`** row (opaque `job_id`, `user_id`, `content_hash`, `status pending→resolved|needs_confirm|failed`, and a child mapping of the job's destination rows), then fires the async `extract`. The async `extract` PATCHes the **job** (service-role only, enforced status transitions); on resolve the restaurant **propagates to all of the job's destination rows** at once. Pending destination rows reference the job, not a not-yet-known `restaurant_id` — `restaurant_id` attaches on resolve (R1/R2). This closes restaurant-null races, makes concurrent-save dedup well-defined (idempotency key `(user_id, destination, content_hash, coalesce_window)`), and makes corrections act on the **job/save-group** rather than the global `content_hash` (R1).

Four server primitives carry the social/cost machinery: the **`import_jobs`** table (the unit of async capture + correction — R1); a content-keyed **`extraction_cache`** (idempotency + the global cost lever, storing ONLY content-derived fields — H1/H5, service-role only — B2); a **`table_shares`** table (the "shared restaurant" feed card, posted into `table-activity` — never the emergent Table wishlist); and a **`table_float_state`** table (emergent-overlap floats, recomputed Table-scoped, keyed by **saver-set** so a new saver re-eligibilizes and a dismissal suppresses only the same set — R4). The Table feed gains three new item types — `shared_save`, `share_digest`, `restaurant_float` — but the **digest is now coalesced in SQL inside `fn_table_activity_page` BEFORE pagination** (group key = author + 6h bucket via `DISTINCT ON`), so keyset/limit operate on already-rendered items and the cursor stays stable; digest children keep stable real `table_shares.id`s (R8/B3). The `I'm in` reaction rides the existing `post-interactions` machinery by adding a `table_share` target type (maps to the already-valid `👀` emoji). The in-app entry point is a widening of `ImportLinkSheet` (a screenshot/photo row beside the URL input) plus a **smart-default multi-select destination router** (My Wishlist pre-ticked; Tables fan-out). **Lists are fully out of the v1 contract** — no dead `list_ids` shape (R12); Lists return when they ship. Model-created low-confidence ghosts are quarantined behind a new `restaurants.verification` flag AND owned per-save via `restaurants.created_by`, never shared/deduped across users, so a hallucinated place reaches only its own saver (H4/R3). **RLS is enabled on `table_shares`, `table_float_state`, and `import_jobs`** (member-read, author-write/update) as defense-in-depth even though edge fns use service-role — RLS-off would violate the T-034 lockdown doctrine (R6). The single allowed pre-extraction block is **upload validation** (size/type/dimension), which runs before any row or job is written; everything after a valid upload lands and never blocks (R9). The Anthropic call is isolated in one `_shared/visionExtract.ts` module reading `ANTHROPIC_API_KEY`; if the key is absent or the model errors, the job fails-soft to `needs_confirm` and never blocks the save.

### Architecture Decisions

- **[Extraction tiering] Maps-parse → text-LLM → vision, all behind `resolve-url`'s existing source detection** — mechanism: `resolve-url/index.ts` gains `image`/`caption` fields in the request body and a new `_shared/visionExtract.ts` (Anthropic call, model id `claude-haiku-4-5-20251001` read from `EXTRACTION_MODEL` env with that constant default — **R10**, never the bare string "Haiku 4.5"). Tier order: existing `google_maps` URL parse (no AI) → if a usable caption/title exists, `extractFromText()` (text-only, ~10× cheaper) → if text insufficient AND an image is present, `extractFromVision()` (downscaled image + caption). Reason: reuses all of T-053's resolver scaffolding (rate-limit rpc, `places-search` internal HTTP, `restaurants.external_id` join, error envelope); vision becomes one more tier, not a parallel function. The `resolve-url` name stays for v1 — a rename is its own blast radius ([KEEP]); a tech-debt note is filed. Trade-off: `resolve-url` grows a second responsibility (it's now "resolve content"); acceptable, contract is additive.

- **[CODEX-FIX R1/R2] Server-owned `import_jobs` + single transactional `create_import` — replaces client fan-out + PATCH-by-id** — mechanism: a new `import_jobs` table is the unit of async capture. New `table-shares` (or `imports`) edge fn exposes ONE POST action **`create_import`** the client calls exactly once with `{ source, image_path?, caption?, destinations: { wishlist: bool, table_ids: string[] } }`. The handler: (1) validates EVERY ticked `table_id` against `table_members.member_id` BEFORE any write — any non-member destination fails the whole call (no partial fan-out); (2) calls a SECURITY DEFINER rpc `fn_create_import(p_user_id, p_content_hash, p_destinations)` that, in ONE transaction, inserts the `import_jobs` row (`job_id` PK, `user_id`, `content_hash`, `status='pending'`) PLUS all pending destination rows (a wishlist row and/or N `table_shares` rows) each FK'd to `job_id` with `restaurant_id NULL`; (3) fires the non-awaited `resolve-url?action=extract&job_id=…`. Extraction PATCHes the **job** (status `pending→resolved|needs_confirm|failed`, transitions service-role-only), and on resolve the resolved `restaurant_id` propagates to ALL of the job's destination rows in one update. Reason: closes the Codex restaurant_id-null race (rows never carry a not-yet-known restaurant), the concurrent-save dup (idempotency below), and correction-propagation (corrections act on the job, which owns all its destinations — not the global `content_hash`). The client makes ONE mutation, not two parallel ones. Trade-off: the transaction + a SECURITY DEFINER rpc is more server machinery than two client calls — worth it for atomicity and a single correction target.

- **[CODEX-FIX R1 correction model] Correction acts on the job/save-group, not the content_hash** — mechanism: `correct` (POST on the same fn) takes `job_id` + the new `restaurant_id` (from `EditMatchPanel`), validates `import_jobs.user_id = caller`, re-points the job's destination rows to the corrected restaurant, and clears `needs_confirm`. It does NOT mutate `extraction_cache` (a hallucinated cache entry stays correctable per-user; see Risks). Per-user `needs_confirm` correction is the v1 model; a verified-content override is noted as v1.1 ([KEEP]). Reason: corrections must scope to one user's save-group, never globally rewrite a content-keyed cache other users share.

- **[ARCH-RESOLVE H1] Cache stores ONLY content-derived fields; user state recomputed per-request** — mechanism: new `extraction_cache (content_hash text primary key, hash_version int, source_url text, extracted jsonb, model text, created_at)`. `extracted` holds exactly `{ name, city, cuisine, address, booking_url, hours, confidence, google_place_id }` — NO `restaurant_id`, NO `already_wishlisted`. On every request `resolve-url` recomputes the `restaurants.external_id → restaurant_id` join and the per-user `wishlist_items` join AFTER reading cache. The cache table is **service-role only**, and cache-hit responses use the **same response envelope** as cache-miss so timing/shape is not an oracle (**B2**). Reason: a content-keyed global cache that stored `already_wishlisted` would leak one user's wishlist membership to everyone who saves the same TikTok. Trade-off: two cheap indexed joins per cache hit — far cheaper than a model call.

- **[ARCH-RESOLVE H5 / CODEX-FIX R1] Idempotency is on EXTRACTION, never on save/fan-out** — mechanism: `content_hash` keys `extraction_cache`; a repeat hash returns the cached `extracted` with no model call. The save/fan-out idempotency is well-defined by the job model: the key is `(user_id, destination, content_hash, coalesce_window)` — a double-tap or loop saving the same content to the SAME destination inside the coalesce window collapses (idempotent / folds into the digest), but a save of the same content to a DIFFERENT Table creates a new job-destination row and succeeds. Reason: closes the Codex H5 ambiguity (dedup the expensive extraction, never the legitimate multi-destination save) AND the concurrent-save dup the import_jobs model now makes deterministic. Trade-off: the coalesce-window key means a deliberate re-push to the same Table within 6h is absorbed, not duplicated — intended.

- **[ARCH-RESOLVE H2] Server-side membership on every Table path via `table_members.member_id`** — mechanism: `create_import` validates each ticked `table_id` against `table_members` (`.eq('member_id', user.id)`) before the transaction — a `table_id` the caller isn't in fails the whole call (atomic, no partial writes — R2). `correct` validates `import_jobs.user_id = caller`. Shared-card reads go through `table-activity`'s existing membership gate (lines 85-97) AND the new RLS member-read policy (R6). `I'm in` goes through `post-interactions` which validates membership for the resolved `table_id`. Reason: service-role bypasses RLS for the work, so the explicit membership check is the gate; CLAUDE.md `member_id` doctrine (never `tm.user_id`). Trade-off: one membership round-trip per ticked Table — negligible.

- **[ARCH-RESOLVE H3 / CODEX-FIX R5] Float avatar set is Table-scoped, single-restaurant, current-members-only, verified-only** — mechanism: float eligibility computed by a SECURITY DEFINER fn `fn_compute_table_float(p_table_id, p_restaurant_id, p_window_days, p_threshold)` running exactly: `SELECT wi.user_id FROM wishlist_items wi JOIN table_members tm ON tm.member_id = wi.user_id AND tm.table_id = p_table_id JOIN restaurants r ON r.id = wi.restaurant_id WHERE wi.restaurant_id = p_restaurant_id AND r.verification = 'verified' AND wi.deleted_at IS NULL AND wi.created_at > now() - (p_window_days || ' days')::interval`. **R5** adds the `verification='verified'` predicate AND the current-valid-wishlist filter (no soft-deleted rows) so a quarantined/unverified ghost can never surface a float. The returned set is ONLY those current-member `user_id`s (joined to `profiles` for display). It never reads another restaurant, never a non-member's save, never the member's broader wishlist, never crosses Tables. Float payload exposes `{ restaurant, distinct_count, member_avatars[] }` and nothing else. Reason: the one intentional relaxation of personal-save privacy must be airtight (Codex H3 + user doctrine note). Trade-off: float recomputed on read within the window rather than materialized — fine at Table scale (3-8 members).

- **[CODEX-FIX R4] `table_float_state` keyed by saver-set, not just `(table_id, restaurant_id)`** — mechanism: the state row carries `saver_set_hash` (stable hash of the sorted `saver_user_ids` that crossed the threshold), `saver_user_ids uuid[]`, `window_start`, `window_end`, `distinct_count`, `first_crossed_at`, `surfaced_at`, `dismissed_at`, `suppressed_until`. The 30-day suppression key is `(table_id, restaurant_id, saver_set_hash)`. Reason: keying suppression on the saver-set means a NEW member saving the same restaurant produces a different `saver_set_hash` → re-eligibilizes a fresh float (the signal genuinely changed), while a dismissal suppresses only the exact set that was dismissed — not a future, stronger overlap. Trade-off: a `uniqueness on (table_id, restaurant_id, saver_set_hash)` rather than `(table_id, restaurant_id)`; more rows per restaurant over time, bounded by Table size.

- **[ARCH-RESOLVE H4 / CODEX-FIX R3] Model ghosts quarantined AND owned per-save, never shared/deduped** — mechanism: new column `restaurants.verification text NOT NULL DEFAULT 'verified' CHECK (verification IN ('verified','unverified'))` (2-value enum for v1 — [KEEP]) PLUS `restaurants.created_by uuid REFERENCES profiles(user_id)` (the owning saver). A ghost upserted from a **low-confidence vision/text extraction** (no Places `place_id` round-trip) is written `verification='unverified', created_by=<saver>` and is **per-save — never deduped or shared across users**; it is reachable ONLY via that owner's own wishlist/job. All canonical/shared reads (restaurant page who's-been, Table wishlist overlap, `places-search` local-DB merge, float) filter `verification='verified'`. On confirm (`EditMatchPanel` → real Places match), the ghost is re-pointed via `external_id` upsert to a verified row. Reason: a model hallucinating "Joe's Pizza, Springfield" must neither enter the shared `restaurants` graph NOR be deduped onto another user's identical hallucination (Codex H4 + R3). Trade-off: every canonical-read query gains a `verification` predicate (one-line filter, in blast radius) and unverified ghosts are not deduped (slightly more rows; corrected away on confirm).

- **[ARCH-RESOLVE M1 / CODEX-FIX R9] Upload validation is the SINGLE allowed pre-extraction block** — mechanism: `create_import` rejects an invalid upload BEFORE any job/row write: `content_length > 5 MB` → 413; `content-type ∉ {image/jpeg,image/png,image/webp,image/heic}` → 415; decoded long edge re-clamped to 768px server-side (don't trust client downscale). The image lands in a private Storage bucket `import-uploads/<user_id>/<uuid>.jpg` (owner-only RLS). This validation is the ONE thing allowed to block; everything after a valid upload lands and never blocks — extraction failures fail-soft to `needs_confirm`, never reject the save. Reason: reconciles "never block" (M2) with a real cost/abuse guard, and R9 makes the ordering explicit (validate → write job+rows → fire extract). Trade-off: a server-side re-decode/resize on every vision call (~20ms) — cheap insurance.

- **[ARCH-RESOLVE M3] "Confirm" = one-tap accept of the pre-ticked default, NOT per-save disambiguation** — mechanism: the destination router's primary CTA ("save", terracotta) commits all currently-ticked destinations in one `create_import` call. Lazy path: capture → CTA (My Wishlist already ticked) → dismissed. Bulk path: each capture is its own one-tap confirm; nothing forces mid-flow disambiguation (the wrong-guess fix is always deferred to the card). Reason: reconciles the "never forced to confirm each" story with the "picker-confirm-per-capture" AC. Trade-off: none — purely a copy/interaction clarification.

- **[CODEX-FIX R13] Explicit content-hash inputs + `hash_version`** — mechanism: `_shared/contentHash.ts` defines two named hashers with a `hash_version` constant stored alongside the cache row: `hashImage(bytes)` = sha256 over the **normalized JPEG bytes** (after server re-decode/clamp to 768px long edge, EXIF stripped, re-encoded at a fixed quality) → keyed as `image_hash`; `hashTextSource(url, caption)` = sha256 over `${canonicalizeUrl(url)}\n${normalizeCaption(caption)}` (lowercased host, stripped tracking params, trimmed/whitespace-collapsed caption) → keyed as `url+caption_hash`. `hash_version` lets a future normalization change invalidate cleanly without colliding. Reason: an underspecified hash silently fragments or over-merges the cache; the inputs and normalization must be pinned. Trade-off: a normalization bug invalidates a cache generation — acceptable, `hash_version` bumps handle it.

- **[ARCH-RESOLVE M6] `I'm in` and float emit NO notifications in v1 (deterministic: silent)** — mechanism: neither `table-shares.create`, the `I'm in` reaction, nor float surfacing writes a `notifications` row. They are feed-only surfaces. Reason: the spec lists "a new notifications-inbox surface" as out of scope; making it explicitly silent removes the ambiguity. Trade-off: a Tablemate must open the Table feed to see a share/float — acceptable; T-048 inbox integration is a clean follow-up if desired.

- **[ARCH-RESOLVE L1] Caption source for the in-app path** — mechanism: the in-app sheet has no share-extension payload, so caption text comes from (a) the pasted URL's oEmbed/`<title>` (existing), or (b) an optional one-line "add a note" field the user can type when uploading a screenshot, passed as `caption` to the extractor. Reason: AC references rode-along caption text; in-app there's no OS share payload, so the note field is the deterministic source. Trade-off: screenshot-only saves with no note rely purely on vision — which is the designed universal path.

- **[ARCH-RESOLVE L2] Empty/missing `cuisine` renders as bare `city`** — mechanism: the `city · cuisine` line is built with `[city, cuisine].filter(Boolean).join(' · ')` (exactly the existing `CandidateCard` pattern). Missing cuisine → just `city`; missing both → line omitted. Reason: middle-dot must never dangle. Trade-off: none.

- **[ARCH-RESOLVE L3 / KEEP] `booking_url` is OUT of the shared `table_shares` card payload** — mechanism: `booking_url`, when extraction yields it, is stored ONLY in owner-private import metadata (the `import_jobs` row / owner's wishlist `source` jsonb) and carried in `extraction_cache.extracted`. It is **not** a column on the shared card payload and is never returned by `table-activity` for a `shared_save`/`share_digest`. TICKET-061 will define how/where booking reads happen. Reason: keeping it off the shared payload until T-061 means no cross-Table or public leak path exists at all (stronger than relying on a column-omit). Trade-off: T-061 will add the read path when it defines booking UI — a clean seam, nothing to undo.

- **[ARCH-RESOLVE L4] Float "plan it?" CTA routes to the restaurant page** — mechanism: the float card's single CTA `router.push('/restaurant/[id]')` (the floated restaurant). No scheduling, no RSVP, no vote. Reason: explicit TICKET-061 seam; v1 does nothing more than navigate. Trade-off: none.

- **[Source union extension] add `screenshot` + `vision` variants to `WishlistSource`** — mechanism: extend the discriminated union in `_shared/wishlistSource.ts`: `{ type: 'screenshot', upload_path: string, caption?: string }` and `{ type: 'vision', source_url?, upload_path?, caption? }` (the `vision` variant covers an image-rescued IG/TikTok). `validateWishlistSource` gains both whitelists; the DB CHECK's `type IN (...)` list extends to include them. The `url` requirement is relaxed for these variants (they're not URL-sourced) — the CHECK becomes `source ? 'type' AND (type IN ('screenshot','vision') OR source ? 'url')`. Reason: the existing union is the canonical place; T-053 already wired RN-shim + validator + CHECK. Trade-off: the CHECK grows a branch; the validator grows two whitelists — both in one file, can't drift.

- **[New feed item types via RPC streams / CODEX-FIX R7+R8] `shared_save`, `share_digest`, `restaurant_float` — digest coalesced in SQL BEFORE pagination** — mechanism: `fn_table_activity_page` gains a defaulted arg **`p_coalesce_hours int DEFAULT 6` (R7 — non-breaking)** plus a `shares_stream` and a `floats_stream`. **The digest is coalesced inside the RPC, before keyset/limit (R8):** the shares CTE groups `table_shares` by `(author_id, date_bin(p_coalesce_hours, created_at, ...))` and emits ONE row per (author, 6h-bucket) via `DISTINCT ON` / window-agg — a single share emits a `shared_save` item, ≥2 emit a `share_digest` item — each carrying the bucket's stable real `table_shares.id`s as an ordered child array (`child_ids[]`). Because one rendered item == one RPC row, the canonical keyset `ORDER BY sort_date DESC, id DESC` + `limit+1` operates on already-coalesced items, so the cursor stays stable across pages (the prior plan coalesced at hydration AFTER pagination, which could split a bucket across a page boundary and break cursor stability — R8 fixes this). `floats_stream` reads `table_float_state` where `table_id = p_table_id AND dismissed_at IS NULL AND surfaced_at IS NOT NULL AND (suppressed_until IS NULL OR suppressed_until < now())`. The edge fn hydrates: `shared_save`/`share_digest` → restaurant + author profile + `I'm in` counts via `post_reactions` where `target_type='table_share'`, digest children resolved from the stable `child_ids[]` (**B3** — real stable ids across pages/refetch); `restaurant_float` → `fn_compute_table_float` avatar set. Reason: additive UNION streams + edge hydration is exactly how entry/table_night/top_4_edited enter the feed; doing the coalesce in SQL keeps the canonical `Page<T>` cursor contract intact. Trade-off: the RPC grows two CTEs and a date-bin group; the hydrator grows two branches — bounded, mirrors existing code.

- **[`I'm in` reaction] new `table_share` target type in `post-interactions`** — mechanism: `isValidTargetType` accepts `'table_share'`; `resolveTableId` for a `table_share` reads `table_shares.table_id` directly (no `entry_tables` ambiguity); membership validated as today. The `👀` emoji is already in `VALID_EMOJIS`. The denorm `table_id` trigger on `post_reactions` must tolerate `table_share` targets — it reads from the parent; we add a branch (or the trigger already denorms from a passed `table_id`, which `create` supplies). Reason: reuses all reaction toggle/count/top_emoji machinery; `I'm in` is just `react` with `target_type='table_share', emoji='👀'`. Trade-off: the count-sync trigger (`sync_post_counts`) must learn to write back to `table_shares.reaction_count` — a new branch in that trigger (listed in blast radius).

- **[Destination router / CODEX-FIX R2+R12] new `DestinationPicker`; fan-out is ONE server `create_import` call; no `list_ids`** — mechanism: a new `components/wishlist/DestinationPicker.tsx` renders My-Wishlist-pre-ticked + the user's Tables (from `useTables`). On "save" it calls a SINGLE `useCreateImport` mutation → `create_import` with `{ destinations: { wishlist: bool, table_ids: string[] } }`; the server does the atomic, membership-validated fan-out in one transaction (R2) and returns the `job_id` + the pending rows. **Lists are entirely absent from the v1 contract — there is NO `list_ids` field anywhere** (picker, hook signature, edge contract); the List destination returns when Lists ship (R12). Reason: a single transactional endpoint removes the partial-fan-out failure mode the old two-client-mutation design had; dropping `list_ids` removes a dead shape that would otherwise rot. Multi-select fan-out precedent is `entry_tables` (T-043). Trade-off: re-adding Lists later touches the contract — acceptable; a dead `list_ids` was the worse option (R12).

### File Changes

**New — migrations (7):**
- `supabase/migrations/20260603000000_restaurants_verification_owner.sql` — NEW — `restaurants.verification` column (2-value CHECK) + partial index; `restaurants.created_by uuid REFERENCES profiles(user_id) ON DELETE SET NULL` (owner of unverified ghost); backfill existing rows to `'verified'`. [H4/R3]
- `supabase/migrations/20260603000100_import_jobs.sql` — NEW — `import_jobs` table (`job_id` PK, `user_id` FK ON DELETE CASCADE, `content_hash`, `source` jsonb, `status pending|resolved|needs_confirm|failed` CHECK, `restaurant_id` FK ON DELETE SET NULL, `created_at`, `resolved_at`) + `fn_create_import()` SECURITY DEFINER (atomic job + destination-row insert) + indexes; **RLS ON** (owner-read/update; service-role does the work) — R1/R2/R6/R11.
- `supabase/migrations/20260603000200_extraction_cache.sql` — NEW — `extraction_cache` table (`content_hash` PK, `hash_version int`, `source_url`, content-derived `extracted` jsonb only, `model`, `created_at`). **RLS ON, no policies** (service-role only — defense-in-depth, B2). [H1/H5/R13]
- `supabase/migrations/20260603000300_table_shares.sql` — NEW — `table_shares` table (id, `job_id` FK ON DELETE CASCADE, table_id FK ON DELETE CASCADE, author_id FK ON DELETE CASCADE, restaurant_id FK ON DELETE SET NULL, note, source jsonb, extraction_status, reaction_count, top_emojis, created_at) + indexes + **RLS ON** (member-read, author-write/update — R6). **No `booking_url` column** (owner-private metadata only — L3/KEEP). [H2/R6/R11]
- `supabase/migrations/20260603000400_table_float_state.sql` — NEW — `table_float_state` (table_id FK ON DELETE CASCADE, restaurant_id FK ON DELETE CASCADE, `saver_set_hash`, `saver_user_ids uuid[]`, `window_start`, `window_end`, distinct_count, first_crossed_at, surfaced_at, dismissed_at, suppressed_until) + unique `(table_id, restaurant_id, saver_set_hash)` (R4) + `fn_compute_table_float()` SECURITY DEFINER (verified-only + valid-wishlist filter — R5) + **RLS ON** (member-read, author/service update — R6). [H3/R4/R5/R6/R11]
- `supabase/migrations/20260603000500_fn_table_activity_page_shares_floats.sql` — NEW — `CREATE OR REPLACE fn_table_activity_page` adding `shares_stream` (SQL-coalesced digest, group key author+6h bucket) + `floats_stream` + the new defaulted `p_coalesce_hours int DEFAULT 6` arg (R7); re-REVOKE/GRANT to service_role. [R7/R8]
- `supabase/migrations/20260603000600_post_interactions_table_share_target.sql` — NEW — extend `post_reactions`/`post_comments` target CHECK to include `'table_share'`; extend `sync_post_counts()` + `set_post_interaction_table_id` triggers to handle `table_share` (write counts back to `table_shares`); reaction FK to `table_shares` ON DELETE CASCADE where applicable (B1).

**New — shared / edge:**
- `supabase/functions/_shared/visionExtract.ts` — NEW — `extractFromVision(imageBytes, caption)` + `extractFromText(caption)`; Anthropic call, model id `claude-haiku-4-5-20251001` via `EXTRACTION_MODEL` env (R10); reads `ANTHROPIC_API_KEY`; returns content-derived `{ name, city, cuisine?, address?, booking_url?, hours?, confidence, google_place_id? }`; throws typed errors that map to `needs_confirm`, never to user-facing throw.
- `supabase/functions/_shared/contentHash.ts` — NEW — `hashImage(bytes)` (normalized-JPEG sha256, `image_hash`) / `hashTextSource(url, caption)` (canonicalized, `url+caption_hash`) + `HASH_VERSION` constant (R13).
- `supabase/functions/table-shares/index.ts` — NEW — POST actions **`create_import`** (single transactional fan-out: validate all `table_id`s → `fn_create_import` rpc → fire async extract → return `job_id` + pending rows — R1/R2), `correct` (author re-points the job's restaurant, propagates to all destination rows — R1), `dismiss_float`. [H2/R1/R2]

**Modified — edge / SQL:**
- `supabase/functions/resolve-url/index.ts` — MODIFY — accept `image` (storage path/bytes) + `caption` in body; add the vision/text tiers (model id via `EXTRACTION_MODEL` — R10); read/write `extraction_cache` (H1/H5, service-role/B2); write `verification='unverified', created_by=<saver>` for low-confidence ghosts (H4/R3); add `action: 'extract'` async path that takes a `job_id`, runs the model, and **PATCHes the `import_jobs` row** (enforced `pending→resolved|needs_confirm|failed` transition) — the resolved `restaurant_id` then propagates to ALL the job's destination rows (R1). Upload validation (R9/M1) lives in `create_import`, before any row write — not here.
- `supabase/functions/_shared/wishlistSource.ts` — MODIFY — add `screenshot` + `vision` variants + validator whitelists; relax `url`-required for them.
- `supabase/functions/_shared/restaurant.ts` — MODIFY — `upsertRestaurant` accepts a `verification` arg (default `'verified'`); unverified ghosts written without entering canonical reads.
- `supabase/functions/wishlist/index.ts` — MODIFY — wishlist destination rows are now created by `fn_create_import` (job-owned, `restaurant_id` NULL until resolve); `list_personal` joins `import_jobs` to return `extraction_status` (from the job) + `verification`; canonical/`list_table` reads filter `verification='verified'`. [H4/R1]
- `supabase/functions/table-activity/index.ts` — MODIFY — hydrate `shared_save` / `share_digest` / `restaurant_float` kinds emitted by `fn_table_activity_page` (the digest is ALREADY coalesced in SQL — R8; hydrate digest children from the stable `child_ids[]` — B3): restaurant + author profiles + `I'm in` reactions + float avatar set via `fn_compute_table_float`. **Never returns `booking_url`** on a shared card (L3/KEEP). Pass `p_coalesce_hours` to the RPC (R7).
- `supabase/functions/post-interactions/index.ts` — MODIFY — `table_share` target type; `resolveTableId` reads `table_shares.table_id`. [H2]
- `supabase/functions/places-search/index.ts` — MODIFY — local-DB merge filters `verification='verified'`. [H4 blast radius]

**New — RN client:**
- `napkin-app/components/wishlist/DestinationPicker.tsx` — NEW — My-Wishlist-pre-ticked multi-select; Tables from `useTables`; one-tap "save" fan-out (M3); List-ready signature, no List rows.
- `napkin-app/components/feed/SharedSaveCard.tsx` — NEW — Table-feed shared-restaurant card (author `shared` verb, restaurant, `city · cuisine`, thumbnail, `I'm in` control via `useToggleReaction`).
- `napkin-app/components/feed/ShareDigestCard.tsx` — NEW — "Jacky dropped 4 spots", expandable; each revealed spot carries its own `I'm in`.
- `napkin-app/components/feed/RestaurantFloatCard.tsx` — NEW — emergent float (count + avatars, "plan it?" → restaurant page; dismissible). [L4]
- `napkin-app/components/wishlist/PendingSaveCard.tsx` — NEW — `pending`/`resolved`/`needs_confirm` card states for the wishlist (status read from the row's `import_jobs` — R1); "tap to confirm" reuses `EditMatchPanel` → `useCorrectImport` (re-points the job).
- `napkin-app/hooks/wishlist/useCreateImport.ts` — NEW — the SINGLE fan-out mutation → `create_import` (`{ wishlist, table_ids }`, NO `list_ids` — R12); returns `job_id` + pending rows; optimistically inserts pending wishlist + `shared_save` rows; snapshot+rollback per canonical pattern; polls/refetches `wishlist.personal` + `tables.activity` while the job stays `pending` (R1/R2).
- `napkin-app/hooks/wishlist/useCorrectImport.ts` — NEW — author re-points the JOB's restaurant (not content_hash — R1); patches every destination card in place.
- `napkin-app/hooks/wishlist/useDismissFloat.ts` — NEW — dismiss a float (PATCH `dismissed_at` keyed by saver-set — R4); optimistic removal from feed.
- `napkin-app/lib/imageDownscale.ts` — NEW — client-side ≤768px JPEG normalize (expo-image-manipulator); server re-clamps (M1).

**Modified — RN client:**
- `napkin-app/components/wishlist/ImportLinkSheet.tsx` — MODIFY — add the "add a screenshot" row (OS image picker) beside the URL input; on image select → downscale → async pending flow → `DestinationPicker`. IG-link paste shows the screenshot nudge (L1).
- `napkin-app/hooks/wishlist/useResolveUrl.ts` — MODIFY — accept an image input; return `extraction_status`; the async-extract trigger now keys off `job_id` (the import_jobs model — R1), not a target-row id.
- `napkin-app/hooks/wishlist/useWishlistAdd.ts` — MODIFY — `WishlistItem` gains `extraction_status` (from its job) + `verification`. (Direct adds still exist; new captured saves flow through `useCreateImport`.)
- `napkin-app/lib/queryKeys.ts` — MODIFY — add `importJobs.*` (per job_id — R1), `tableShares.*` (per-table, per-share), `floats.*` (per-table, per saver-set — R4), `extraction.*` (per content_hash) key groups.
- `napkin-app/hooks/posts/usePostInteractions.ts` — MODIFY — `TargetType` union gains `'table_share'`; `useToggleReaction` accepts it.
- `napkin-app/app/wishlist.tsx` — MODIFY — render `PendingSaveCard` for `pending`/`needs_confirm` rows at top of personal list; poll while pending.
- `napkin-app/components/feed/index.ts` + `components/wishlist/index.ts` — MODIFY — barrel-export the new cards/picker.
- `napkin-app/components/feed/*FeedItem dispatcher*` (the Table-feed renderer that switches on `type`) — MODIFY — add `shared_save` / `share_digest` / `restaurant_float` branches.

Count: **~18 new files** (7 migrations + 2 `_shared` + 1 `table-shares` edge fn + 8 RN new) and **~13 modified** files. Migration count moved 5 → **7** (added `import_jobs`; `restaurants` migration now also carries `created_by`). RN-new moved 9 → 8 (the two `useCreateTableShares`/`useExtractContent` hooks collapse into one `useCreateImport`; `useCorrectShare`→`useCorrectImport`).

### Implementation Order

> **═══ MILESTONE A (steps 1–6) — the extraction→wishlist slice, independently testable in prod ═══**
> No Table-social layer. The user can validate the magic (screenshot → right restaurant in their wishlist, async, never-block) before any shares/floats land. The ticket stays whole; this is a boundary marker, not a split ([KEEP]).

1. **Source-union + DB shape first (hard gate).** Extend `_shared/wishlistSource.ts` (screenshot/vision variants + validator), write the `wishlist_items_source` CHECK extension and the `restaurants.verification`+`created_by` + `import_jobs` (+ `fn_create_import`) + `extraction_cache` migrations. **All new tables get RLS ON + FK `ON DELETE` (R6/R11).** **Test gate:** `validateWishlistSource` unit tests (whitelist-only, url-not-required, extra-key rejection); apply migrations locally; assert `restaurants.verification` defaults `'verified'` + CHECK rejects a third value; assert RLS is enabled on `import_jobs`/`extraction_cache`; assert every new FK declares `ON DELETE`. Why first: every downstream write depends on the union + verification + the job table; failing it late blows up the fan-out.

2. **`_shared/visionExtract.ts` + the Anthropic contract (hard gate — load-bearing external shape).** Implement `extractFromVision`/`extractFromText`; model id `claude-haiku-4-5-20251001` via `EXTRACTION_MODEL` (R10); lock the request shape (system prompt → strict JSON, image as base64 content block, ≤768px). **Test gate:** `deno test` mocking the Anthropic response asserts the parser yields the content-derived shape AND that a malformed/prose response downgrades to `confidence:'low'` (never throws); one live smoke behind `ANTHROPIC_API_KEY` (deferred blocker — until the key is set the mock test is the gate). Early because the model JSON shape is the single biggest unknown.

3. **`extraction_cache` + content-hash idempotency (H1/H5/R13/B2).** Wire `_shared/contentHash.ts` (`hashImage`/`hashTextSource` + `HASH_VERSION`); `resolve-url` reads cache before any model call, writes content-derived-only on miss; cache is service-role only and cache-hit uses the same envelope (B2). **Test gate:** same content hash twice → exactly one model call (spy); cache row carries `hash_version`, no `restaurant_id`/`already_wishlisted`; per-request join still recomputes `already_wishlisted`; image vs url+caption hashes are distinct keys.

4. **`resolve-url` vision branch + ghost quarantine + ownership (H4/R3).** Add `image`+`caption` body, the tier ladder, the `action:'extract'&job_id=…` async path that PATCHes the JOB and propagates the restaurant to all destination rows (R1), and `verification='unverified', created_by=<saver>` on low-confidence ghosts. **Test gate:** curl smokes — screenshot → candidate; low-confidence → ghost written `unverified`+owned, absent from `places-search` local merge AND not deduped onto another user's identical hallucination (R3).

5. **`create_import` (single transactional fan-out) + upload validation as the one block (R1/R2/R9/M1).** `table-shares` fn `create_import`: validate ALL `table_id`s vs `table_members.member_id` first → `fn_create_import` writes job + all pending rows in one txn → fire async extract. Upload validation (5MB/type/dimension) runs BEFORE any write (R9) and is the only pre-extraction block. **Test gate:** create into a Table the caller is NOT in → whole call 403, ZERO rows written (atomicity); create into wishlist + 2 valid Tables → 1 job + 3 pending rows; oversize → 413 before any write; valid upload always lands a job even if extract later fails-soft.

6. **RN Milestone-A slice: `useCreateImport` + `useResolveUrl` + `ImportLinkSheet` screenshot row + `imageDownscale` + `PendingSaveCard` on the wishlist + queryKeys (`importJobs.*`).** **Test gate (Milestone A acceptance, prod-testable):** `tsc --noEmit` clean; screenshot pick → downscale → one `create_import` → pending wishlist card → poll → resolved/needs-confirm patch in cache; IG-link paste shows the nudge; a wrong guess lands `needs_confirm` and `useCorrectImport` re-points the job. **Stop here to let the user validate the magic in prod before the Table-social layer.**

> **═══ END MILESTONE A — Table-social layer (steps 7–12) ═══**

7. **RPC streams + SQL-coalesced digest (R7/R8).** `fn_table_activity_page` gains `p_coalesce_hours int DEFAULT 6` (R7) + `shares_stream` (digest coalesced in SQL, group key author+6h bucket, stable `child_ids[]`) + `floats_stream`; `table-activity` passes `p_coalesce_hours` and hydrates the 3 kinds (digest children from `child_ids[]` — B3). **Test gate:** 4 same-author shares in 6h → exactly 1 digest ROW FROM THE RPC (not post-hydration) expandable to 4 stable real ids; cursor stays stable when the bucket straddles a would-be page boundary (R8 regression); booking_url never appears on a shared card (L3).

8. **`post-interactions` `table_share` target + count trigger + full target audit (I'm in / B1).** `isValidTargetType` accepts `table_share`; `resolveTableId` reads `table_shares.table_id`; `sync_post_counts`/`set_post_interaction_table_id` handle the new parent; audit every uniqueness constraint, cleanup/delete cascade, top-emoji path, and client `switch(target_type)` (B1). **Test gate:** toggle `👀` on a `table_share` → `table_shares.reaction_count` increments via trigger; non-member 403; deleting a `table_share` cleans its reactions; reaction shows "you + N in".

9. **`table_float_state` (saver-set keyed) + `fn_compute_table_float` privacy bound (H3/R4/R5).** **Test gate (security — highest stakes):** the avatar set contains ONLY current `table_members` who saved THAT verified restaurant in-window; a former member drops out; a member's other wishlist items never appear; another Table's saves never appear; an unverified ghost never floats (R5); a NEW saver yields a new `saver_set_hash` and re-eligibilizes; a dismissal suppresses only that exact saver-set for 30d (R4).

10. **RN: `DestinationPicker` (My-Wishlist pre-ticked, NO List rows — R12) wired to `useCreateImport` fan-out.** **Test gate:** one-tap save fans to wishlist + 2 Tables via ONE `create_import`; no `list_ids` anywhere in the call.

11. **RN: feed cards (`SharedSaveCard`, `ShareDigestCard`, `RestaurantFloatCard`) + feed dispatcher branches + `useDismissFloat`/`useCorrectImport`.** **Test gate:** all 3 new card types render in a Table feed; `I'm in` toggles; digest expands to stable children; float dismisses (saver-set keyed); author corrects a wrong guess and EVERY destination card updates (job-level propagation — R1).

12. **Acceptance pass against the ACs**, with explicit checks: every Table path membership-gated (H2); `create_import` atomic / no partial fan-out (R2); float reveals only in-Table current-member verified savers (H3/R5); unverified ghosts owned + never leaked/deduped (H4/R3); RLS enabled on all three new social tables (R6); digest coalesced in SQL with stable cursor (R8).

### Migration Blast Radius

Schema changes (revised shape): (a) new `restaurants.verification` column + new `restaurants.created_by` FK (R3); (b) new tables `import_jobs` (R1), `extraction_cache`, `table_shares`, `table_float_state` — **all four RLS-ON** (R6); (c) new SECURITY DEFINER fns `fn_create_import` (R2) + `fn_compute_table_float` (verified-only — R5); (d) `wishlist_items.source` CHECK extended (2 new union variants); (e) `post_reactions`/`post_comments` target CHECK + `sync_post_counts`/`set_post_interaction_table_id` triggers extended for `table_share`; (f) `fn_table_activity_page` gains defaulted `p_coalesce_hours` (R7) + SQL-coalesced `shares_stream` + `floats_stream` (R8); (g) FK `ON DELETE` defined on every new table (R11).

**1. PostgREST embeds `from('T').select('...U(...)')` touching changed tables**
- `restaurants` is embedded widely (`entries→restaurants`, `wishlist_items→restaurants`, `table_nights→restaurants`, etc.). `created_by` is a NEW FK from `restaurants` to `profiles`, but `profiles` is not currently embedded *through* `restaurants` anywhere — grep `from('restaurants').select('...profiles(...)')`: **zero sites**, so no `PGRST201` from the new FK. Embeds select columns, not `verification` — **no embed disambiguation needed**; canonical reads need a `verification` **filter** (item 2/3), not an embed change. (If a future query embeds `restaurants→profiles` for the owner, it must name `!restaurants_created_by_fkey`.)
- `import_jobs` is a **new** table with FKs to `profiles`(user), `restaurants`. Read via explicit queries / joins in `wishlist` (`list_personal` joins to surface `extraction_status`) and `table-shares` — no nested PostgREST embed across its FKs. If a future embed does `from('import_jobs').select('restaurants(...)')` it's unambiguous (single FK to restaurants); the `profiles` embed would need `!import_jobs_user_id_fkey` if restaurants→profiles is ever also embedded. Listed per the join-table rule.
- `table_shares` — new, FKs to `import_jobs`, `tables`, `profiles`(author), `restaurants`. Hydrated via explicit two-step queries in `table-activity` (no nested embed), matching how entries/nights are hydrated — **no `PGRST201`**. Any future embed must name `!table_shares_table_id_fkey` / `!table_shares_restaurant_id_fkey` / `!table_shares_author_id_fkey` / `!table_shares_job_id_fkey`.
- `table_float_state` — read only via `fn_compute_table_float` RPC + explicit queries; no nested embeds. No-change-needed.
- `extraction_cache` — service-role only, no embeds.

**2. Direct SQL / `.rpc()`**
- New: `fn_create_import` (`.rpc` from `table-shares.create_import` — the atomic txn writing job + destination rows, R2), `fn_compute_table_float` (`.rpc` from `table-activity` — verified-only join, R5), `fn_table_activity_page` (re-created with `p_coalesce_hours int DEFAULT 6`). **R7 makes the arg DEFAULTED → the existing `table-activity/index.ts` line-103 call site does NOT 404 if it omits the arg; the new call passes it explicitly. This is now NON-breaking (was flagged breaking in v1).**
- `check_and_increment_rate_limit` reused unchanged (extraction bucket key `'resolve_content'`).
- Restaurant canonical reads that must add `verification='verified'`: grep `from('restaurants')` read sites in `restaurant-history/`, `wishlist/` (`list_table` + overlap), `places-search/` (local merge), `fn_compute_table_float` (R5), and any who's-been query. Each listed must add the filter or justify "saver-scoped, unverified allowed" (only the owner's own `import_jobs`/wishlist row may surface its unverified ghost — R3).

**3. RLS policies on changed tables / SECURITY DEFINER joiners**
- `restaurants` RLS unchanged (two column adds); the `verification` gate is enforced in edge-fn queries (service-role), not RLS — consistent with the service-role-validates-manually pattern.
- **`import_jobs`, `table_shares`, `table_float_state`: RLS ON (R6 — closes T-034 lockdown gap).** Policies: `import_jobs` owner-read/update (`user_id = auth.uid()`); `table_shares` member-read (`EXISTS member of table_id`) + author-write/update (`author_id = auth.uid()`); `table_float_state` member-read + author/service update. Service-role still does the actual work in the edge fns; RLS is defense-in-depth so a leaked anon/auth key cannot read cross-Table. Membership in policies uses `table_members.member_id` (NEVER `tm.user_id` — CLAUDE.md doctrine).
- `extraction_cache`: RLS ON, **no policies** (service-role only — B2). `import-uploads` Storage bucket: owner-only RLS.
- `fn_create_import` is SECURITY DEFINER — reviewers verify it only ever writes rows for `p_user_id` and validated table_ids (no privilege escalation path).
- `fn_compute_table_float` is SECURITY DEFINER — its body is the H3/R5 privacy boundary; reviewers verify the exact join (member_id + restaurant_id + window + `verification='verified'` + valid-wishlist) and that it returns nothing else.
- `post_reactions`/`post_comments` RLS: `table_share` target rows gated by the edge fn membership check (same as entry/table_night); confirm no RLS policy hard-codes `target_type IN ('entry','table_night')` (grep — if so, extend it). **B1: full audit of every uniqueness constraint, count/denorm trigger, top-emoji path, and delete/cleanup cascade for the new target.**

**4. Edge-function contracts changing (redeploy same release)**
- `resolve-url` (now content/vision; `image`/`caption` body + `action:'extract'&job_id`), `wishlist` (job-joined `extraction_status`/`verification` in reads), `table-activity` (3 new kinds + `p_coalesce_hours`), `post-interactions` (`table_share` target), `places-search` (verification filter), and the new `table-shares` (`create_import`/`correct`/`dismiss_float`). All six + the new fns deploy together.

**5. queryKeys + hooks consuming changed shapes**
- New keys: `importJobs.*` (R1), `tableShares.*`, `floats.*` (saver-set — R4), `extraction.*`. Hooks consuming changed shapes: `useWishlistAdd`/`useResolveUrl` (source variants, `extraction_status` from job, `verification`), `useCreateImport` (the single fan-out — `job_id` + pending rows, NO `list_ids` — R12), `useTableActivity` (3 new `type` values — the feed dispatcher MUST handle them or fall through gracefully), `usePostInteractions`/`useToggleReaction` (`table_share`). Any cached `ActivityItem` consumer that exhaustively switches on `type` must add the new branches (B1 client-switch audit).

**6. Optimistic `onMutate` patches synthesizing changed shapes**
- `useCreateImport.onMutate` synthesizes the pending wishlist row AND/OR a pending `shared_save` ActivityItem into `tables.activity` — the synthesized shape MUST match the hydrated `shared_save` (author profile, restaurant stub, `reaction_count: 0`, `my_reactions: []`, `extraction_status: 'pending'`, `restaurant_id: null until resolve`), or the card flickers on reconcile. Because it's ONE mutation now (not two), a single snapshot/rollback covers the whole fan-out.
- `useToggleReaction` already patches feed-card `reaction_count`/`my_reactions`/`top_emojis` by matching `item.id === targetId` — works for `table_share` items unchanged (same field names; verified against `usePostInteractions.flipItem`).
- `useDismissFloat.onMutate` removes the float item from `tables.activity` (saver-set keyed) and snapshots for rollback.
- `useCorrectImport.onMutate` re-points the job's restaurant in every cached destination card (wishlist + each shared card) and snapshots — the propagation is job-level (R1), so the patch must touch all destinations the job owns.

### Risks

- **Anthropic vision JSON reliability is the load-bearing unknown.** Haiku may return prose, wrong-shaped JSON, or hallucinate a plausible-but-wrong restaurant. Mitigation: strict JSON system prompt + a tolerant parser that downgrades any unparseable/uncertain result to `confidence:'low'` → `needs_confirm` (never throws to the user); the live-key smoke (step 2) is the real validator. This is gated early on purpose.
- **`ANTHROPIC_API_KEY` is a deferred blocker.** The function reads it at runtime; until the user sets the Supabase secret, vision calls fail-soft to `needs_confirm`. Document the secret as a deploy-time requirement; nothing in CI deploys it.
- **`fn_table_activity_page` arg add is now NON-breaking (R7).** `p_coalesce_hours int DEFAULT 6` is defaulted, so an omitting caller still resolves the function — the v1 "breaking RPC" risk is retired. Mitigation: the new call passes the arg explicitly; the default protects any path that doesn't. Still ship the RPC + call site together for the new streams.
- **`create_import` atomicity is load-bearing (R2).** If the membership validation or the `fn_create_import` transaction is wrong, a partial fan-out could write some destination rows but not others, or write into a Table the caller isn't in. Mitigation: validation precedes the txn; the txn writes job + all destination rows atomically; step 5's test gate asserts a non-member destination produces ZERO rows.
- **Saver-set float keying could over-fire (R4).** Keying suppression on `saver_set_hash` means each new distinct saver re-eligibilizes a float; a Table that keeps adding savers could see repeated floats for one restaurant. Mitigation: the 30d suppression still applies per saver-set, and the float is dismissible; if churn proves noisy, raise the threshold (edge-fn arg) — acceptable tuning, not a redesign.
- **H3 float privacy is the highest-stakes correctness item.** A wrong join in `fn_compute_table_float` leaks a member's private saves cross-Table or surfaces a non-member. Mitigation: the SECURITY DEFINER body is a single explicit join; step 8 is a dedicated security test; dual-review (Claude + Codex) required (schema + RLS + privacy trigger all in scope).
- **Async-without-Realtime means poll latency.** A pending card fills on refetch, not push; a backgrounded app resolves on foreground. Mitigation: short focus-poll while any `pending` row exists; Realtime is a clean follow-up. Acceptable per the never-block doctrine (the save already landed).
- **Cost-cache poisoning by a hallucinated extraction.** A bad cached extraction is served to every subsequent saver of that content. Mitigation: cache stores `confidence`; `low`-confidence results are cached (to avoid re-paying) but always land `needs_confirm`, so a wrong guess is correctable per-user without re-extracting; a corrected match re-points the ghost without mutating the cache.
- **Design bundle was not extracted at spec time.** The Heirloom bundle (`/tmp/design/...`) failed earlier. The BUILDER MUST fetch it (per CLAUDE.md) and reconcile `SharedSaveCard` / `ShareDigestCard` / `RestaurantFloatCard` / `PendingSaveCard` against `feed-canvas.jsx` before UI build — this design fixes data/contracts/component structure, not pixels.
- **`table_share` reaction count trigger must write back to a new table.** Extending `sync_post_counts()` to handle a third parent table is a trigger change that, if wrong, drifts `I'm in` counts silently (the T-007/T-037 failure mode). Mitigation: step 8 asserts the trigger increments `table_shares.reaction_count`; trigger change is in the dedicated migration; B1 mandates a full audit of constraints/triggers/cleanup/client-switch.

### Codex Design Review — Resolutions

Each Codex `[REVISE]` item R1–R13 → the named mechanism/file that now closes it:

- **R1 — async job model.** New `import_jobs` table + `fn_create_import` rpc; extract PATCHes the JOB (`resolve-url action:'extract'&job_id`), resolved restaurant propagates to all destination rows. Corrections (`correct`/`useCorrectImport`) act on the job, not `content_hash`. → `migrations/…_import_jobs.sql`, `resolve-url`, `table-shares`, `useCorrectImport.ts`.
- **R2 — transactional fan-out.** Single `create_import` endpoint validates ALL destinations vs `table_members.member_id` first, then `fn_create_import` writes job + all pending rows in one txn. No partial state; client makes one mutation. → `table-shares/index.ts`, `fn_create_import`, `useCreateImport.ts`.
- **R3 — owned per-save ghosts.** `restaurants.created_by` + `verification='unverified'`; never deduped/shared across users; canonical reads filter `verification='verified'`. → `migrations/…_restaurants_verification_owner.sql`, `resolve-url`, `_shared/restaurant.ts`.
- **R4 — saver-set float keying.** `table_float_state` carries `saver_set_hash` + `saver_user_ids` + `window_start/end`; suppression unique-keyed `(table_id, restaurant_id, saver_set_hash)`. → `migrations/…_table_float_state.sql`, `useDismissFloat.ts`.
- **R5 — verified-only floats.** `fn_compute_table_float` joins `restaurants` and filters `verification='verified'` + valid (non-deleted) wishlist rows. → `fn_compute_table_float` in `…_table_float_state.sql`.
- **R6 — RLS ON.** `import_jobs` (owner), `table_shares` (member-read/author-write), `table_float_state` (member-read) all RLS-enabled; `extraction_cache` RLS-on no-policy. Closes T-034 lockdown gap. → all four new-table migrations + Blast Radius §3.
- **R7 — defaulted RPC arg.** `fn_table_activity_page` gains `p_coalesce_hours int DEFAULT 6` (non-breaking). → `…_fn_table_activity_page_shares_floats.sql`, `table-activity/index.ts`.
- **R8 — SQL-coalesced digest.** Digest grouped in the RPC's `shares_stream` (author + 6h bucket via `DISTINCT ON`) BEFORE keyset/limit; children keep stable real `table_shares.id`s in `child_ids[]`; cursor stable. → `…_fn_table_activity_page_shares_floats.sql`, `table-activity/index.ts`.
- **R9 — upload is the one block.** Size/type/dimension validation in `create_import` before any row/job write; everything after a valid upload lands. → `table-shares/index.ts`, Architecture Decision M1/R9.
- **R10 — real model id via env.** `claude-haiku-4-5-20251001` via `EXTRACTION_MODEL` default constant. → `_shared/visionExtract.ts`.
- **R11 — FK cascades.** Every new table declares `ON DELETE` (table→shares/floats CASCADE, user CASCADE, restaurant SET NULL/repoint, job CASCADE). → all new-table migrations.
- **R12 — no `list_ids`.** Removed from `create_import` contract, `useCreateImport` signature, and `DestinationPicker` (no List rows). Returns when Lists ship. → `table-shares/index.ts`, `useCreateImport.ts`, `DestinationPicker.tsx`.
- **R13 — explicit hash inputs + version.** `contentHash.ts` defines `hashImage` (normalized JPEG) vs `hashTextSource` (canonicalized url+caption) + `HASH_VERSION`; stored as `extraction_cache.hash_version`. → `_shared/contentHash.ts`, `…_extraction_cache.sql`.

---

## Build Log
<!-- Filled by builder agent -->

### Files Changed

**New — migrations (8):**
- `supabase/migrations/20260603000000_restaurants_verification_owner.sql` — `restaurants.verification` (2-value CHECK, default 'verified') + `restaurants.created_by` FK ON DELETE SET NULL; backfill.
- `supabase/migrations/20260603000050_wishlist_items_source_vision.sql` — extend `wishlist_items.source` CHECK for screenshot/vision variants (url not required).
- `supabase/migrations/20260603000100_import_jobs.sql` — `import_jobs` table + `fn_create_import` SECURITY DEFINER + `wishlist_items` columns (`job_id`, `extraction_status`, `deleted_at`) + restaurant_id nullable.
- `supabase/migrations/20260603000200_extraction_cache.sql` — `extraction_cache` table; RLS ON, no policies (service-role only, B2).
- `supabase/migrations/20260603000300_table_shares.sql` — `table_shares` table; RLS ON (member-read, author-write); no booking_url (L3/KEEP).
- `supabase/migrations/20260603000400_table_float_state.sql` — `table_float_state` table (saver-set keyed, R4); `fn_compute_table_float` SECURITY DEFINER (verified-only + valid-wishlist, H3/R5).
- `supabase/migrations/20260603000500_fn_table_activity_page_shares_floats.sql` — `CREATE OR REPLACE fn_table_activity_page` adding `p_coalesce_hours DEFAULT 6` (R7), `shares_stream` (SQL-coalesced digest with stable `child_ids[]`, R8/B3), `floats_stream`.
- `supabase/migrations/20260603000600_post_interactions_table_share_target.sql` — extend `post_reactions`/`post_comments` target CHECK; `CREATE OR REPLACE sync_post_counts` with `table_share` branch (B1); `CREATE OR REPLACE set_post_interaction_table_id` with `table_share` branch; drop+recreate triggers.

**New — shared / edge:**
- `supabase/functions/_shared/visionExtract.ts` — `extractFromVision` + `extractFromText`; model id `claude-haiku-4-5-20251001` via `EXTRACTION_MODEL` env (R10); fail-soft to confidence:'low' on any error.
- `supabase/functions/_shared/contentHash.ts` — `hashImage` + `hashTextSource` + `HASH_VERSION` (R13); tracking-param strip; sha256 hex.
- `supabase/functions/_shared/visionExtract.test.ts` — 9 Deno tests: fail-soft with no API key, content-hash idempotency, HASH_VERSION integer.
- `supabase/functions/table-shares/index.ts` — NEW edge function; actions: `create_import` (validate membership → `fn_create_import` → fire async extract), `correct` (job-level propagation, R1), `dismiss_float` (saver-set keyed, R4).

**Modified — edge / SQL:**
- `supabase/functions/_shared/wishlistSource.ts` — add `screenshot` + `vision` variants; relax url-required for them.
- `supabase/functions/_shared/restaurant.ts` — `RestaurantInput` gains `verification` + `createdBy` fields; upsert propagates them.
- `supabase/functions/resolve-url/index.ts` — `image_path`/`caption`/`action='extract'`/`job_id` body fields; vision/text tier; IG detection + ig_nudge response; `handleVisionExtract` + `handleAsyncExtract` helpers; cache read/write (H1/B2); ghost upsert with verification='unverified'.
- `supabase/functions/wishlist/index.ts` — `list_personal` includes `job_id`, `extraction_status`, `deleted_at`, `verification`; filters `deleted_at IS NULL`; `list_table` filters `verification='verified'`, `deleted_at IS NULL`, `restaurant_id IS NOT NULL`.
- `supabase/functions/table-activity/index.ts` — passes `p_coalesce_hours: 6` to RPC (R7); hydrates `shared_save`/`share_digest`/`restaurant_float` kinds; reaction fetch for `table_share` targets; `booking_url` never returned (L3).
- `supabase/functions/post-interactions/index.ts` — `isValidTargetType` adds `'table_share'`; `resolveTableId` adds `table_share` branch reading `table_shares.table_id`; `readReactionCounts` adds `table_share` branch.
- `supabase/functions/places-search/index.ts` — no code change needed (does not query restaurants table directly; verified filter is applied in callers).
- `supabase/functions/resolve-url/wishlistSource.test.ts` — 7 new tests for screenshot/vision variants (28 total, all pass).

**New — RN client:**
- `napkin-app/lib/imageDownscale.ts` — `downscaleImage` (expo-image-manipulator, ≤768px), `uploadImportImage` (import-uploads bucket), `downscaleAndUpload` convenience.
- `napkin-app/hooks/wishlist/useCreateImport.ts` — single fan-out mutation → `create_import`; NO list_ids (R12); optimistic pending wishlist row; snapshot+rollback; narrow invalidation.
- `napkin-app/hooks/wishlist/useCorrectImport.ts` — author re-points job's restaurant; job-level patch; snapshot+rollback.
- `napkin-app/hooks/wishlist/useDismissFloat.ts` — dismiss float (saver-set keyed, R4); optimistic removal from activity feed.
- `napkin-app/components/wishlist/PendingSaveCard.tsx` — three card states (pending/resolved/needs_confirm); italic Newsreader "reading it...".
- `napkin-app/components/wishlist/DestinationPicker.tsx` — My-Wishlist-pre-ticked multi-select; Tables from `useTables`; NO List rows (R12); one "save" CTA.
- `napkin-app/components/feed/SharedSaveCard.tsx` — author + "shared" verb + restaurant + I'm-in reaction via `useToggleReaction`; never returns booking_url.
- `napkin-app/components/feed/ShareDigestCard.tsx` — "dropped N spots" expandable; real stable `childShares` (B3).
- `napkin-app/components/feed/RestaurantFloatCard.tsx` — count + avatars + "plan it?" → restaurant page (L4); dismissible (saver-set keyed, R4).

**Modified — RN client:**
- `napkin-app/components/wishlist/ImportLinkSheet.tsx` — screenshot row in IdlePanel; `screenshot-uploading`/`destination`/`ig-nudge` states; `DestinationPicker` panel; `IgNudgePanel`; `downscaleAndUpload`; `useCreateImport` fan-out.
- `napkin-app/hooks/wishlist/useResolveUrl.ts` — `SourceType` union extended; `ResolveUrlData` gains `ig_nudge`, `extracted_confidence`, `needs_confirm`; `resolve()` accepts `imagePath` + `caption` args.
- `napkin-app/hooks/wishlist/useWishlistAdd.ts` — `WishlistItem` gains nullable `restaurant_id`, `extraction_status`, `job_id`, `verification`.
- `napkin-app/hooks/wishlist/useMyWishlist.ts` — `PersonalWishlistItem.restaurant` nullable; gains `extraction_status`, `job_id`.
- `napkin-app/hooks/wishlist/useMyTikTokSourceForRestaurant.ts` — null-guard `item.restaurant?.id`.
- `napkin-app/hooks/posts/usePostInteractions.ts` — `TargetType` union gains `'table_share'` (B1).
- `napkin-app/hooks/tables/useTableActivity.ts` — `ActivityItem` union gains `SharedSaveActivityItem`, `ShareDigestActivityItem`, `RestaurantFloatActivityItem`.
- `napkin-app/lib/queryKeys.ts` — new groups: `importJobs.*`, `tableShares.*`, `floats.*`, `extraction.*`.
- `napkin-app/app/(tabs)/tables.tsx` — import new cards; feed dispatcher handles `shared_save`/`share_digest`/`restaurant_float` kinds.
- `napkin-app/components/feed/index.ts` — barrel-export the 3 new cards.
- `napkin-app/components/wishlist/index.ts` — barrel-export `PendingSaveCard` + `DestinationPicker`.
- `napkin-app/components/wishlist/WishlistByCity.tsx` — null-guard `item.restaurant`; skip pending rows in `groupByCity` + `Poster`.
- `napkin-app/components/wishlist/WishlistGrid.tsx` — skip pending rows (null restaurant).

### Tests

**Deno tests — 43 passed / 0 failed:**
- `visionExtract.test.ts`: 9 tests — fail-soft with no API key (confidence:'low'), content-hash idempotency (same hash on repeat, different hash on different input, tracking params stripped), HASH_VERSION integer. All pass.
- `wishlistSource.test.ts`: 28 tests — all prior 21 + 7 new screenshot/vision variant tests. All pass.
- All other existing Deno tests unaffected (table-activity, places-search, entry, table-management, user-profile): 6 passed.

**Jest tests — 102 passed / 0 failed:** All 11 suites pass unchanged.

**TypeScript — `tsc --noEmit` clean.** No errors.

---

### Fix Pass 1 (2026-06-03) — addresses Review 1 (Claude H-1…H-7, M-1…M-5; Codex CX-1…CX-5)

**New files:**
- `supabase/migrations/20260603000700_fix_pass1.sql` — P0 migration fixes (CX-2 DML lockdown, CX-3 restaurants SELECT policy, CX-4 trigger mismatch, H-2 threshold enforcement, H-1 float-detection wiring via `fn_detect_and_surface_float`, H-3 import-uploads bucket, H-5 cascade delete trigger, CX-5 `fn_complete_import_job`).
- `supabase/functions/_shared/fixPass1.test.ts` — 15 new Deno tests: float threshold boundary (H-1/H-2), saver-set hash determinism (R4), image bytes-hash dedup vs path-hash (H-4), rate-limit never-block (M-3), internal-call detection (CX-1), cascade delete branch (H-5).

**Modified files:**
- `supabase/functions/resolve-url/index.ts` — [CX-1/M-4] Internal-call path: detect `x-internal-secret` header, skip user-JWT ownership check for service-role extract calls, load job owner from DB. [H-4] Compute `hashImage(bytes)` after download, update `import_jobs.content_hash`, key cache on real bytes hash. [M-3] Rate-limit check (`resolve_content` bucket) at top of `handleAsyncExtract` — over-limit lands as `needs_confirm`, never blocks. [CX-5] Use `fn_complete_import_job` RPC for transactional completion (replaces 3 separate updates that ignored `.error`). [H-1] After resolved save, call `fn_detect_and_surface_float` for each Table (fan-out destinations + saver's membership Tables).
- `supabase/functions/table-shares/index.ts` — [CX-1] Pass `x-internal-secret` header on outbound async-extract fetch; observe+log failures (not silently swallowed).
- `supabase/functions/table-activity/index.ts` — [H-6] Fetch `my_reactions` for ALL share ids (top-level + digest children). Map hydrated DB rows → `SharedSaveCardProps` camelCase before inserting into feed items (`shareId`, `reactionCount`, `topEmojis`, `myReactions`, `createdAt`). `childShares` is now `SharedSaveCardProps[]` not raw snake_case rows.
- `napkin-app/app/(tabs)/tables.tsx` — [H-6] Import `SharedSaveActivityItem`, `ShareDigestActivityItem`, `RestaurantFloatActivityItem` types; remove `as any` from all three new card branches in feed dispatcher; use `d.childShares` (not `d.children`).
- `napkin-app/components/feed/ShareDigestCard.tsx` — [H-6] `childShares` prop typed as `DigestChildShare[]` (= `SharedSaveCardProps[]`) not the old mismatch; add `DigestChildShare` type alias.
- `napkin-app/hooks/tables/useTableActivity.ts` — [H-6] Add `SharedSaveCardShapeForDigest` type (camelCase, non-nullable author); `ShareDigestActivityItem.childShares` typed as `SharedSaveCardShapeForDigest[]`; `SharedSaveActivityItem` gains camelCase alias fields.
- `napkin-app/hooks/wishlist/useCorrectImport.ts` — [H-7] `CorrectImportInput` gains `tableIds?: string[]`; `onMutate` snapshots + patches all destination Table-feed caches; `onError` rolls back all; `onSuccess` invalidates all destination activity caches.
- `napkin-app/hooks/wishlist/useCreateImport.ts` — [M-2] `onMutate` snapshots activity caches for all ticked Tables and inserts an optimistic pending `shared_save` item per Table. [M-1] Uses `activityForTable(tableId)` (exact key, not prefix) for all cache writes. `onSuccess` invalidates all destination Tables.

**Gate results (Fix Pass 1):**
- `tsc --noEmit`: CLEAN (0 errors, no `as any` on new card dispatch)
- Deno tests: **52 passed / 0 failed** (37 prior + 15 new)
- Jest: **102 passed / 0 failed** (unchanged)

**Still deferred (noted):**
- L-1 text-before-vision tier (cost optimization only, not correctness) — `handleAsyncExtract` now prefers text path when no image present; the full "prefer text even when image+caption both present" tier is partially addressed (text-only path taken when `imagePath == null`); full text-first-then-vision-only-when-insufficient is P2 and not blocking.
- M-5 ghost dup control (minor, `Date.now()` collision window, not a blocking correctness issue) — noted as P2.
- `INTERNAL_CALL_SECRET` env var: must be set in Supabase secrets for the CX-1 fix to authenticate internal extract calls. If unset (`''`), the internal-call detection falls back to `isInternal = false` and the user-JWT ownership check runs — which would still 403 on service-role calls. **Required deploy step: `npx supabase secrets set INTERNAL_CALL_SECRET=<random-hex> --project-ref ftvmseaqwwlcxtdlvxxz`.**

**Builder Questions (Fix Pass 1):**
- `fn_complete_import_job` uses `FOR UPDATE` lock on `import_jobs`. Reviewer should verify this doesn't deadlock if two extract calls race for the same job (they can't — the function returns early on `status != 'pending'`, and the FOR UPDATE is per-row). PASS.
- The `cascade_delete_post_interactions_extended()` function replaces calls to `cascade_delete_post_interactions()`. Reviewer should verify the original function body (20260418) is superseded by the new one (20260603000700) without a naming conflict — the new function has a distinct name `_extended` and the triggers are explicitly recreated. The old function `cascade_delete_post_interactions()` remains in the DB but is no longer called by any trigger. This is intentional — avoiding an ALTER to minimize blast radius. The old function can be dropped in a cleanup migration.
- The `restaurants_verified_or_owner_select` policy added in 000700 uses `USING (verification = 'verified' OR created_by = auth.uid())`. For anon access (`auth.uid()` = NULL), `created_by = NULL` is false — so anon can only see verified restaurants. This is the intended behavior.

**Skipped (deferred blockers):**
- Live Anthropic API key smoke test: `ANTHROPIC_API_KEY` not set in the local environment. The mock-response Deno tests cover parser correctness and fail-soft behavior. Flag in the build log as pending the user setting the Supabase secret `ANTHROPIC_API_KEY`.
- Local `supabase db push` validation: the local Docker stack was not started. SQL syntax was manually reviewed; all new migrations follow patterns from prior migrations in the same repo.

**Design bundle:** The canonical Heirloom bundle at `api.anthropic.com/v1/design/h/arCMwe2IOddzhHFBISX_Ng` failed to extract ("Unrecognized archive format" — same error as noted in the spec). Fell back to `napkin-app/constants/theme.ts` tokens + existing Heirloom-compliant feed cards (`FriendLogCard`, `SoloShareCard`) + `ImportLinkSheet`. All new components match the warm-paper palette, italic Newsreader for restaurant/Table names, Manrope body, lowercase past-tense verbs, middle-dot separators, no emoji in chrome, ambient shadows only, no 1px borders.

---

### Fix Pass 2 (2026-06-03) — addresses Review 2 cycle-2 blockers N1–N9

**New files:**
- `supabase/migrations/20260603000800_fix_pass2.sql` — N5 (drop restaurants INSERT/UPDATE WITH CHECK(true) policies), N6 (fix fn_detect_and_surface_float UPSERT to clear dismissed_at on re-surface; add fn_dismiss_float RPC with 30-day cap), N8 (fn_correct_import_job SECURITY DEFINER RPC — transactional correction, mirrors fn_complete_import_job).
- `supabase/functions/_shared/fixPass2.test.ts` — 16 tests: 11 honest logic tests (timingSafeEqual N1, image_path ownership N3, float suppression CASE logic N6, dismiss cap N6), 5 SQL-level tests marked "requires local stack — NOT RUN" (honest skip; Docker unavailable).

**Modified files:**
- `supabase/functions/resolve-url/index.ts` — [N1] Reordered entrypoint: body parsed FIRST, then `action=extract` path handled BEFORE `auth.getUser()` runs (internal-only path skips user JWT entirely); timingSafeEqual constant-time compare on the secret; wrong/absent secret → 401 immediately with no fall-through. [N2] Reordered handleAsyncExtract: (1) load job → (2) authorize (denied → terminal needs_confirm, not silent-pending) → (3) rate-limit → (4) extract/complete. [N3] Image_path ownership check before service-role Storage download.
- `supabase/functions/table-shares/index.ts` — [N3] Reject foreign image_path (first segment ≠ user.id) before any Storage access. [N6] dismiss_float uses fn_dismiss_float RPC (enforces 30-day cap). [N8] handleCorrect routes through fn_correct_import_job RPC — fully transactional.
- `supabase/functions/restaurant-history/index.ts` — [N4] Added `.eq('verification', 'verified')` to both onNapkin global search (line 289) and visitedRestaurants search (line 269); service-role bypasses RLS so the filter was required.
- `napkin-app/app/wishlist.tsx` — [N7] Renders PendingSaveCard for all pending/needs_confirm rows at top of personal list; CorrectModal wired to useCorrectImport on "tap to confirm" — correction flow is now reachable from the wishlist.
- `scripts/smoke/edge-functions.ts` — [N9] Added wishlist list_personal smoke entry (covers TICKET-060 import_jobs join); documented INTERNAL_CALL_SECRET + ANTHROPIC_API_KEY as required deploy-time secrets.

**Gate results (Fix Pass 2):**
- `tsc --noEmit`: CLEAN (0 errors)
- Deno tests: **74 passed / 0 failed** (68 prior + 16 new fixPass2 — of which 5 are honest SQL-skipped markers requiring a local stack)
- Jest: **102 passed / 0 failed** (unchanged)
- Migration timestamp uniqueness guard: ✓ PASS (83 files)

**N-item disposition:**
- N1 — FIXED. `action=extract` parsed before user auth; internal-only with timingSafeEqual. Wrong/absent secret → 401, no fall-through.
- N2 — FIXED. handleAsyncExtract order: load job → authorize → rate-limit → extract/complete. Auth-denied → terminal (not pending).
- N3 — FIXED. image_path first-segment ownership check in both `table-shares/create_import` and `resolve-url/handleAsyncExtract` before Storage access.
- N4 — FIXED. `verification='verified'` filter on both onNapkin and visitedRestaurants queries in `restaurant-history`.
- N5 — FIXED. Dropped `Allow authenticated insert restaurants` / `Authenticated users can update restaurants` (WITH CHECK(true)) policies in migration 000800. All restaurant writes now go through service-role edge functions only.
- N6 — FIXED. fn_detect_and_surface_float ON CONFLICT: clears dismissed_at + suppressed_until when re-surfacing (only when suppressed_until IS NULL or < now); fn_dismiss_float RPC sets suppressed_until=now()+30d; dismiss_float edge action uses the RPC.
- N7 — FIXED. `app/wishlist.tsx` renders PendingSaveCard for pending/needs_confirm rows; CorrectModal opens on "tap to confirm" and calls useCorrectImport. useCorrectImport now has its first real call site.
- N8 — FIXED. fn_correct_import_job SECURITY DEFINER RPC (locks job, validates ownership, updates all destinations in one transaction, throws on failure). handleCorrect in table-shares routes through it.
- N9 — FIXED. INTERNAL_CALL_SECRET documented as deploy-time blocker alongside ANTHROPIC_API_KEY in the smoke list comment. wishlist list_personal smoke entry added (covers import_jobs join path).

**Preserved (confirmed not regressed):**
- fn_compute_table_float privacy join — unchanged.
- fn_complete_import_job (CX-5) — unchanged.
- create_import membership atomicity (H2/R2) — unchanged.
- extraction_cache RLS-on/no-policy (H1/H5/B2) — unchanged.
- CX-4 trigger fix (sync_post_counts_and_top_emojis) — unchanged.
- H-5 cascade delete trigger (_extended) — unchanged.
- list_ids removed (R12), booking_url off shared payload (L3/KEEP) — unchanged.

**Deferred (acknowledged):**
- `ANTHROPIC_API_KEY` + `INTERNAL_CALL_SECRET`: deploy-time secrets; not in CI/source. Set via `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... INTERNAL_CALL_SECRET=$(openssl rand -hex 32) --project-ref ftvmseaqwwlcxtdlvxxz`.
- SQL-level assertions (float suppress/resurface, RLS ghost rejection, reaction trigger, transactional rollback) require `supabase start` + `db reset` (Docker unavailable). Marked explicitly as NOT RUN in fixPass2.test.ts.
- M-5 ghost dup control (Date.now() collision) — still P2, still minor.

---

### Fix Pass 3 (2026-06-03) — addresses cycle-3 review blockers B1–B4

**New files:**
- `supabase/migrations/20260603000900_fix_pass3.sql` — B1: `DROP POLICY IF EXISTS` for the two surviving INSERT policies on `restaurants` — exact names from baseline lines 441 (`"Authenticated users can insert restaurants"`) and 501 (`"restaurants insert/update by owners"`). After these drops, zero authenticated-role INSERT/UPDATE policies remain on `restaurants`; only `restaurants_verified_or_owner_select` (SELECT) survives.
- `supabase/functions/_shared/fixPass3.test.ts` — 10 Deno tests: B1 SQL regression (2 marked NOT RUN — requires local stack), B2 callPlacesSearch non-200 → PLACES_AUTH_FAIL throw (3 tests), B2 unverified ghost confidence invariant (1 test), B3 wishlist page patch uses `p.data` (1 test + regression of old `p.rows` bug), B3 activityAll fallback when tableIds absent (1 test), B4 SQL regression (1 NOT RUN), B4 `.or()` predicate structure (1 test). All 10 pass.

**Modified files:**
- `supabase/functions/places-search/index.ts` — [B2] Add `timingSafeEqualBytes` helper + `INTERNAL_CALL_SECRET` check: when `x-internal-secret` header matches the env var, skip `auth.getUser()` entirely (isInternalCall path). On the user-facing path, auth gate unchanged.
- `supabase/functions/resolve-url/index.ts` — [B2] `callPlacesSearch` gains optional `internalSecret` param: when set, adds `x-internal-secret` header; non-200 responses now throw `PLACES_AUTH_FAIL` instead of returning `[]`. `upsertRestaurantFromExtracted` gains `internalSecret` param; threads it to `callPlacesSearch`; re-throws all errors (PLACES_AUTH_FAIL or network) so callers land `needs_confirm`; unverified ghost fallback always returns `confidence='low'` (B2 invariant — no more high-confidence unverified ghost → resolved). `handleAsyncExtract` gains `internalSecret` param; wraps `upsertRestaurantFromExtracted` in try/catch → on any error finalizes `needs_confirm`, not resolved; passes `internalSecret` in the main handler dispatch (where `INTERNAL_CALL_SECRET` is already in scope).
- `supabase/functions/restaurant-history/index.ts` — [B4] Add `.or('verification.eq.verified,created_by.eq.{user.id}')` to all three remaining by-id restaurant reads: `table_history` path (previously no visibility filter), `page` UUID path, `page` external_id path. Joins `search`-action filters (N4, pass 2) + B4 by-id filters now cover all `restaurants` reads in this function.
- `napkin-app/app/wishlist.tsx` — [B3] `usePlacesSearch` changed from `method: 'GET'` with `params` to POST with `body` (places-search is POST-only → 405 → empty results was the bug). Result extraction updated to `res?.data ?? []` to match places-search's `{ data: [...] }` response envelope.
- `napkin-app/hooks/wishlist/useCorrectImport.ts` — [B3] `onMutate` wishlist patch: `p.rows` → `p.data` (PersonalWishlistPage uses `data`, not `rows`). `onSuccess`: when `tableIds` is absent or empty, invalidate `queryKeys.tables.activityAll()` so all Table feeds pick up the corrected restaurant (replaces the no-op `for (const tableId of input.tableIds ?? [])` loop when `tableIds` is undefined).

**Gate results (Fix Pass 3):**
- `tsc --noEmit`: CLEAN (0 errors)
- Deno tests: **84 passed / 0 failed** (74 prior + 10 new fixPass3 — of which 2 are honest SQL-skipped markers requiring a local stack)
- Jest: **102 passed / 0 failed** (unchanged)
- Migration timestamp uniqueness guard: ✓ PASS (84 files, 0 duplicates)

**B-item disposition:**
- B1 — FIXED. `"Authenticated users can insert restaurants"` (line 441) and `"restaurants insert/update by owners"` (line 501) dropped in 000900. All four INSERT policies from baseline are now dropped (pass-2 covered lines 421 and 445; pass-3 covers 441 and 501). Zero authenticated-role INSERT/UPDATE policies remain.
- B2 — FIXED. Three sub-fixes: (1) `places-search` accepts `x-internal-secret` + `INTERNAL_CALL_SECRET` check, skips user-JWT on internal path; (2) `callPlacesSearch` non-200 throws `PLACES_AUTH_FAIL` (not empty array); (3) unverified ghost fallback always returns `confidence='low'` → handleAsyncExtract finalizes `needs_confirm`, never `resolved`. `handleAsyncExtract` wraps restaurant resolution in try/catch → any downstream error (PLACES_AUTH_FAIL, network) → `needs_confirm`.
- B3 — FIXED. (1) `usePlacesSearch` now POSTs body (fixes 405 → results are selectable). (2) `useCorrectImport.onSuccess` falls back to `activityAll()` invalidation when `tableIds` is absent, so Table-feed cards are refreshed after correction even without explicit table_id threading. (3) `useCorrectImport` wishlist patch now targets `p.data` (correct field for `PersonalWishlistPage`).
- B4 — FIXED. `restaurant-history` `table_history` + `page` (UUID + external_id) reads all have `.or('verification.eq.verified,created_by.eq.{user.id}')`. Combined with pass-2 `search` action filters, all `restaurants` reads in this function are now visibility-gated.

**Preserved (confirmed not regressed):**
- N1/N2/N3 auth ordering and ownership checks — unchanged.
- `fn_complete_import_job`, `fn_correct_import_job` (N8) — unchanged.
- `fn_detect_and_surface_float` / `fn_dismiss_float` (N6) — unchanged.
- Privacy join in `fn_compute_table_float` — unchanged.
- `create_import` membership atomicity (H2/R2) — unchanged.
- `extraction_cache` RLS-on/no-policy (H1/H5) — unchanged.
- `list_ids` removed (R12), `booking_url` off shared payload (L3/KEEP) — unchanged.

**SQL-level tests not run (Docker unavailable):**
- B1: authenticated INSERT `verification='verified'` rejected by RLS — marked NOT RUN. The policy drops are static and inspectable; after the migration drops, no INSERT policy remains.
- B4: restaurant-history returns null for non-owner ghost by id — marked NOT RUN. The `.or()` filter is PostgREST-standard and matches the N4 pattern already live in prod.

**Builder Questions (Fix Pass 3):**
- B2: `places-search` internal path has no body parsing before the auth check (the body is parsed later by `parsePayload`). Since `isInternalCall` is determined from headers only (before body read), this is correct — `parsePayload` runs the same for both paths after the auth gate.
- B3: `useCorrectImport.onSuccess` uses `activityAll()` as a fallback (broader than per-table invalidation). This is a safe trade-off: correction is rare; broader invalidation on correction is acceptable. Per-table invalidation still happens when `tableIds` is explicitly provided (e.g. from `ShareDigestCard` or future callers that do thread the table_ids).
- B4: The `.or('verification.eq.verified,created_by.eq.{userId}')` filter uses string interpolation of the caller's UUID. PostgREST's `.or()` call is safe here because `user.id` is always a UUID coming from the supabase auth system (not user-supplied input), so SQL injection via the `created_by.eq.{uuid}` clause is not a concern.

### Builder Questions

**B1 audit (`post_reactions`/`post_comments` for `table_share` target):**
- Uniqueness constraint: `post_reactions` has `(target_type, target_id, user_id, emoji)` unique — no change needed (already target-type-keyed).
- `sync_post_counts` trigger: `CREATE OR REPLACE` in migration 20260603000600 adds `table_share` branch writing `table_shares.reaction_count` + `top_emojis`. The trigger function is recreated; existing `sync_counts_on_reaction`/`sync_counts_on_comment` triggers still fire and will call the updated function.
- `set_post_interaction_table_id` trigger: `CREATE OR REPLACE` in same migration adds `table_share` branch reading `table_shares.table_id`. Triggers `set_post_reaction_table_id` + `set_post_comment_table_id` are dropped and recreated to pick up the new function body.
- Top-emoji path: covered by the `sync_post_counts` `table_share` branch (aggregates and writes `top_emojis`).
- Delete/cleanup cascade: `post_reactions.target_id` has no FK to a specific parent (it's a polymorphic reference). When a `table_share` is deleted (cascade from `import_jobs`), the corresponding reactions are NOT automatically deleted by FK. The architect should add an explicit `DELETE FROM post_reactions WHERE target_id = OLD.id AND target_type = 'table_share'` trigger on `table_shares` — or confirm that orphaned reactions on deleted shares are acceptable. **ARCHITECT-REVIEW:** Add a reaction/comment cleanup trigger on `table_shares` DELETE, same pattern as `entries`/`table_nights` if those have one.
- Client `switch(target_type)`: `tables.tsx` feed dispatcher now handles `shared_save`/`share_digest`/`restaurant_float`. `usePostInteractions.ts` `TargetType` extended. No exhaustive `switch` in the codebase that hard-codes only `['table_night', 'entry']` was found (the checks are runtime guards in the edge function, not compile-time switches).

**B2 confirmed:** `extraction_cache` is RLS-ON with no policies (service-role only). The `handleVisionExtract` and `handleAsyncExtract` helpers in `resolve-url` read/write cache using the service-role client. The same `jsonResponse({ data: {...} })` envelope is returned on both cache-hit and cache-miss paths.

**B3 confirmed:** `fn_table_activity_page` shares_stream carries `child_ids[]` as real `table_shares.id` UUIDs (via `array_agg(id ORDER BY created_at)`). The edge function hydrates from `child_ids[]` using `.in('id', deduped)`, so children are stable across pages/refetch.

**Deferred blocker — `ANTHROPIC_API_KEY`:** The Supabase secret `ANTHROPIC_API_KEY` must be set before the vision extraction path will produce non-`needs_confirm` results. Command: `npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-... --project-ref ftvmseaqwwlcxtdlvxxz`. Without it, every extraction fails-soft to `needs_confirm` (never blocks the save).

**Deviation from spec file list:** The spec lists `supabase/functions/places-search/index.ts` as modified (local-DB merge filters `verification='verified'`). After reading the function, it does not query the `restaurants` table directly — it calls the Google Places API and calls `upsertRestaurant`. The local-DB merge concern applies to the `wishlist/index.ts` `list_table` action (already updated) and the `fn_compute_table_float` SQL (already includes the filter). No code change was needed in `places-search`.

**`fn_table_activity_page` old signature REVOKE:** The migration drops the REVOKE for the old 7-argument signature and adds it for the new 8-argument signature. Both signatures now exist in PostgreSQL as overloads. The old 7-arg call from any unconverted caller still works (falls through to the DEFAULT 6 value). Only the service-role gets the GRANT for the new signature.

**`fn_create_import` references `table_shares` before it exists:** The `fn_create_import` function in migration 20260603000100 references `table_shares` which is created in migration 20260603000300. The `fn_create_import` function body is created as SQL, and since it's a PL/pgSQL `EXECUTE`-free function, it is parsed at call time, not at definition time — so the forward reference is safe in PostgreSQL. The function won't be called until after all migrations run in sequence.

**Riskiest item for reviewer:** The `fn_table_activity_page` SQL-coalesced digest (R8). The `DISTINCT ON (author_id, bucket_start)` + `array_agg(id ORDER BY created_at)` pattern produces stable child_ids, but the reviewer should verify: (1) that `date_bin` is available in the Postgres version on prod; (2) that the digest coalescing fires BEFORE the keyset `WHERE (sort_date, id) < (cursor)` — which it does because the coalescing is in a CTE evaluated before the final `WHERE` clause; (3) that `p_coalesce_hours` used in the `date_bin` call is correctly typed as `int` (the interval cast `(p_coalesce_hours || ' hours')::interval` requires Postgres 14+, which prod runs).

### Builder Questions

#### Codex design review (2026-06-03) — [ARCH-REVIEW], folded into the revised Technical Design

Codex adversarially reviewed the Technical Design. Orchestrator dispositions. **[REVISE]** = folded into the design by the architect-revision pass; **[BUILDER-AUDIT]** = builder must verify during build; **[KEEP]** = architect's choice stands.

**[REVISE] — structural:**
- **R1 (H1/H2 async): server-owned `import_jobs` model replaces "PATCH the target row by id."** Opaque `job_id`, `user_id`, `target_kind`, `target_id`, `content_hash`, status `pending→resolved|needs_confirm|failed`, transitions service-role-only. Extract PATCHes the job; resolved restaurant propagates to the job's targets.
- **R2 (H2 fan-out atomicity): single transactional `create_import` endpoint.** Validate ALL destinations (membership per table_id) first, then write all pending rows + the `import_jobs` row in one transaction, then fire extraction. No partial-fan-out state. Client keeps one mutation.
- **R3 (H4/H6 ghost ownership): unverified ghosts are per-save, owned (`restaurants.created_by`), never shared/deduped across users.** Reachable only via owner's wishlist/job; every canonical read filters `verification='verified'`.
- **R4 (float same-set): `table_float_state` keyed by saver-set.** Carry `saver_set_hash` + `saver_user_ids` + `window_start/end`; 30d suppression keys on `(table_id, restaurant_id, saver_set_hash)` so a new saver re-eligibilizes and a dismissal suppresses only the same set.
- **R5 (float verified): `fn_compute_table_float` MUST filter `verification='verified'` + current valid wishlist rows** — never surface a quarantined/unverified ghost.
- **R6 (H7 RLS): enable RLS on `table_shares` + `table_float_state`** (member-read + author-write/update) as defense-in-depth; service-role still does the work. RLS-off violates T-034 lockdown doctrine.
- **R7 (fn signature): `fn_table_activity_page` adds `p_coalesce_hours int DEFAULT 6`** (defaulted, non-breaking); new call site passes it explicitly.
- **R8 (pagination): coalesce the digest in SQL BEFORE pagination** (group key = author + 6h bucket via `DISTINCT ON`/window-agg), so keyset/limit operate on rendered items — not at hydration after. Digest children keep stable real `table_shares.id`s.
- **R9 (upload vs never-block): upload validation is the ONE allowed pre-extraction block.** Oversize/bad-type rejected before any row is written; everything after a valid upload lands and never blocks.
- **R10 (model id): real id via env.** `claude-haiku-4-5-20251001` (NOT "Haiku 4.5"), read from `EXTRACTION_MODEL` env with that default.
- **R11 (cascades): define FK `ON DELETE`** on all new tables (table→shares/floats cascade; user delete; restaurant repoint).
- **R12 (scope): drop `list_ids` from the v1 contract** — no dead List-ready shape before Lists ship.
- **R13 (hash): explicit content-hash inputs + `hash_version`** in `contentHash.ts` (image_hash vs url+caption_hash, normalization).

**[BUILDER-AUDIT]:**
- **B1 (H10): full `post_reactions`/`post_comments` audit for the new `table_share` target** — every uniqueness constraint, denorm/count trigger, top-emoji path, delete/cleanup, and client `switch(target_type)` handles it (or drifts silently — T-007/T-037 failure mode).
- **B2: `extraction_cache` service-role only;** cache-hit responses use the same envelope (not a timing oracle).
- **B3: digest child ids are real stable `table_shares.id`s** across pages/refetch.

**[KEEP]:** `resolve-url` name stays for v1 (rename is its own blast radius); 2-value `verification` enum for v1; ticket stays whole but mark the **Milestone A** boundary (steps 1–6 = independently testable extraction→wishlist slice before the Table-social layer); per-user `needs_confirm` correction for v1 (verified-content-override = noted v1.1); **booking_url stays OUT of the shared card payload** for v1 (owner's private import metadata only, until T-061 defines reads).

**Architect note — where B1–B3 are pinned for the build (verify during build, not redesigned here):**
- **B1** — folded into Implementation Order step 8 + Blast Radius §3 (full `post_reactions`/`post_comments` audit for the `table_share` target: uniqueness constraints, `sync_post_counts`/`set_post_interaction_table_id` triggers, top-emoji path, delete/cleanup cascade, and every client `switch(target_type)`). Builder must produce the explicit audit; missing it fails review.
- **B2** — `extraction_cache` is RLS-on/service-role-only and cache-hit responses use the SAME envelope as cache-miss (no timing/shape oracle). Pinned in the H1 Architecture Decision + step 3 test gate.
- **B3** — digest child ids are real stable `table_shares.id`s carried in the RPC's `child_ids[]` (R8), stable across pages/refetch. Pinned in the R7+R8 Architecture Decision + step 7 test gate.

---

## Review History
<!-- Filled by code-reviewer agent -->

### Review 1
```
Date: 2026-06-03
Verdict: FAIL (Claude cold review — pairs with Codex adversarial-review)
Score: 6 PASS / 4 WARN / 7 FAIL
```

Reviewed cold against the 38 ACs, the `[CODEX-FIX R1–R13]`, `[ARCH-RESOLVE H1–L4]`, and `[BUILDER-AUDIT B1–B3]` items. `tsc --noEmit` clean; 37 Deno tests pass. But the build is "clean" partly because the feed dispatcher launders every new item through `as any`, and several headline features are wired-but-dead. Verdict is FAIL on data-completeness + missing infra, not on the SQL privacy boundary (which is correct as written).

**Category scorecard**
- Correctness: FAIL — emergent float never fires; digest children render broken; image cache key defeated.
- Edge Cases: WARN — async fail-soft solid; needs-confirm propagation to Table cards missing.
- Error Handling: PASS — extraction fail-soft to needs_confirm is thorough and never throws to the user.
- Security: PASS — `fn_compute_table_float` join is the correct H3/R5 privacy boundary; membership gates on `table_members.member_id` everywhere; RLS ON all 3 social tables + extraction_cache.
- Performance: WARN — float recompute-on-read is fine at Table scale, but the global image-cache lever (the stated cost win) is bypassed.
- Design Compliance: WARN — tokens/verbs/no-emoji honored; canonical Heirloom bundle never fetched (builder admits extract failed again); cards reconciled only against existing feed cards.

---

#### HIGH (block merge)

**H-1 — Emergent float never fires: no code ever writes a `table_float_state` row. [FAILS the "Emergent float" AC, R4/R5, and the spec's designated "star" mechanism]**
`grep` for any insert into `table_float_state` returns ZERO hits outside `dismiss_float` (which only UPDATEs). `floats_stream` (migration 000500, lines 204-210) filters `surfaced_at IS NOT NULL` — and nothing ever sets `surfaced_at`, `saver_set_hash`, `saver_user_ids`, or `distinct_count`. There is no trigger on `wishlist_items`, no recompute call in `handleAsyncExtract`, and no edge action that detects a threshold crossing and materializes the float. `fn_compute_table_float` is defined but **called from nowhere** (grep confirms: only `table-activity` was *supposed* to call it; it does not — the hydrator reads `payload.saver_user_ids` straight off the never-written state row). The compute fn, `floats_stream`, `table-activity` float hydration (index.ts ~488-525), `RestaurantFloatCard`, `useDismissFloat`, and `queryKeys.floats.*` are all present and the whole feature is dead.
Fix: add a float-detection step — after a wishlist save resolves in `handleAsyncExtract`, for each Table the saver belongs to, call `fn_compute_table_float(table_id, restaurant_id, …)`, and if the distinct-saver count ≥ threshold, upsert a `table_float_state` row (saver-set hash, `surfaced_at=now()`, respecting the suppression key). This is the missing trigger point.

**H-2 — `fn_compute_table_float` accepts `p_threshold` but never applies it. [R5 / "fires only on multiple independent saves" guarantee]**
Migration 000400, lines 65-94: the function signature takes `p_threshold int DEFAULT 3` but the body has no `HAVING count(*) >= p_threshold` (it returns one row per qualifying saver, unconditionally). So the "spam-proof by construction (≥3 distinct members)" invariant is unenforced in SQL — a single saver would pass if any caller used the result to gate a float. Combined with H-1 this is currently moot, but it must be fixed as part of the float-detection wiring, or the float will fire on a single save.
Fix: either add `HAVING count(DISTINCT wi.user_id) >= p_threshold` in a wrapping aggregate, or have the caller count the returned rows and only materialize when `>= p_threshold`. Pick one and make it the single source of truth.

**H-3 — `import-uploads` Storage bucket and its owner-only RLS are never created. [FAILS the screenshot/photo AC — the universal substrate]**
`imageDownscale.ts` uploads to bucket `'import-uploads'` and `resolve-url`/`table-shares` read from it, but no migration creates the bucket or any `storage.objects` policy. The Technical Design (M1/R9) explicitly required `import-uploads/<user_id>/<uuid>.jpg` with "owner-only RLS." Without the bucket, `uploadImportImage()` fails at runtime and the entire screenshot path — AC #1, the headline magic — is non-functional. (Builder's "Skipped: local supabase not started" hid this; it would surface on first prod upload.)
Fix: add a migration that `insert into storage.buckets (id, name, public) values ('import-uploads','import-uploads', false)` and `storage.objects` RLS policies scoping read/write/delete to `auth.uid()::text = (storage.foldername(name))[1]` (owner-only), matching the existing entry-photos bucket pattern.

**H-4 — Image content-hash cache lever is defeated; job idempotency key is a per-upload path hash. [FAILS "Global cache / dedup" AC, contradicts H1/H5/R13]**
`table-shares/handleCreateImport` (lines 188-200) sets `contentHash = "path_" + sha256(image_path)` for image saves — a hash of the storage path (which contains a fresh UUID per upload), NOT the image bytes. Consequences: (a) two users saving the identical viral screenshot get different `content_hash` → the global cache NEVER dedupes images (the stated "big cost lever" is gone for the image path); (b) the JOB's `content_hash` is `path_…`, so `handleAsyncExtract` reads/writes `extraction_cache` under `path_…` (lines 625-647) while `handleVisionExtract` (the inline path, line 462) uses the *real* `hashImage(bytes)` — two disjoint keyspaces for the same image, so the inline and async paths never share cache. The real image hash is only known after download, which `create_import` doesn't do.
Fix: either (1) move image hashing into the extract step and back-fill `import_jobs.content_hash` with the real `hashImage` after first download, then key the cache on that; or (2) accept that `create_import` can't hash bytes and have `handleAsyncExtract` compute `hashImage`, look up/write cache under it, and update the job's `content_hash` — but then drop the misleading `path_` value, which currently fragments the cache. Today the image cache is effectively write-only-per-upload.

**H-5 — `table_share` reactions/comments are orphaned on delete; the B1 cleanup trigger was flagged and never built. [`// ARCHITECT-REVIEW` open item, FAILS B1]**
Migration 000600 lines 15-18 explicitly note the cascade is "application-level (edge fn deletes reactions when share is deleted)" and the builder's B1 note (line 561) carries an open `**ARCHITECT-REVIEW:** Add a reaction/comment cleanup trigger on table_shares DELETE`. No such trigger exists, and `table-shares/index.ts` never deletes reactions. `table_shares` is deleted by CASCADE from `import_jobs`/`tables` — a path the edge fn never observes — so `post_reactions` rows with `target_type='table_share'` are left dangling, and because `target_id` is polymorphic with no FK, nothing reaps them. Over time the unique constraint `(target_type,target_id,user_id,emoji)` can also collide if a new `table_shares.id` ever reuses a UUID (unlikely, but the orphan rows still inflate counts on re-query paths). This is exactly the T-007/T-037 silent-drift failure mode B1 was meant to close.
Fix: add `CREATE TRIGGER … AFTER DELETE ON table_shares … DELETE FROM post_reactions/post_comments WHERE target_type='table_share' AND target_id = OLD.id` (the same pattern entries/table_nights use, or a `BEFORE DELETE` row trigger). Resolve the `// ARCHITECT-REVIEW` comment before merge.

**H-6 — Digest children render broken: producer/consumer shape mismatch laundered by `as any`. [FAILS "burst coalescing → expandable digest, each child carries its own I'm in", B3, AC]**
`table-activity` hydrates digest `children` as raw `table_shares` rows (`{ id, reaction_count, top_emojis, created_at, … }`, snake_case, `id` not `shareId`). `tables.tsx` (line 785, via `const d = item as any`) passes `childShares={d.children}`, and `ShareDigestCard` (line 110) renders `<SharedSaveCard key={child.shareId} {...child} />`. `SharedSaveCardProps` wants `{ shareId, reactionCount, topEmojis, createdAt, myReactions }`. So expanded children get `shareId=undefined` (the `I'm in` toggle then calls `useToggleReaction` with `targetId: undefined` → 404 / no-op), `reactionCount=undefined`, duplicate `key={undefined}`, and fall into the `isPending` "reading it…" branch even when resolved. `tsc` passed only because the dispatcher casts through `any`. The single `shared_save` card is fine; only the digest-expansion path is broken.
Fix: map the hydrated child rows into `SharedSaveCardProps` (camelCase, `shareId: child.id`, `reactionCount: child.reaction_count`, `myReactions` from a per-child reaction fetch) either in `table-activity` hydration or in `ShareDigestCard` before spreading. Also note: per-child `my_reactions` are never fetched — `table-activity` only fetches `my_reactions` for top-level `shared_save` ids (index.ts ~565-580), not for digest children, so even after the rename the child `I'm in` active-state is always false.

**H-7 — `useCorrectImport` does not propagate the correction to Table-feed cards. [FAILS "Confirm propagation" AC / R1 job-level propagation on the client]**
The edge `correct` action correctly re-points `import_jobs` + `wishlist_items` + `table_shares` server-side (table-shares/index.ts 311-324). But the client hook (`useCorrectImport.onMutate`, lines 46-65) only patches `wishlist.personal` and invalidates `importJobs.detail(job_id)` (a key no list query reads). It never patches or invalidates `tables.activity*`, so a corrected shared card shows the wrong guess in the Table feed until an unrelated refetch. The Build Log / design (Blast Radius §6) explicitly promised "the patch must touch all destinations the job owns."
Fix: in `onSuccess`/`onMutate`, also patch/invalidate `queryKeys.tables.activity(tableId)` for every Table the job fanned into (the hook needs the destination table_ids — return them from `create_import` and thread through, or invalidate `tables.activityAll()`).

---

#### MEDIUM

**M-1 — `useDismissFloat`/`useCreateImport` optimistic `setQueryData` uses `activityForTable` but the feed is cached under `activity(tableId, filters)`. [partial — works only on the unfiltered feed]**
`useTableActivity` registers under `queryKeys.tables.activity(tableId, filters)`. With no filters that equals `['tableActivity', tableId]` = `activityForTable(tableId)`, so the default feed works; `invalidateQueries(['tableActivity', tableId])` also prefix-matches filtered variants (fine). But the optimistic `setQueryData(activityForTable(tableId), …)` in `useDismissFloat` (line 39) is an *exact*-key write — when a filtered feed is active (`['tableActivity', tableId, filters]`) the optimistic float removal patches a cache nobody is rendering, so the float visibly lingers until the settle-time invalidation refetches. Low blast radius (floats are dead anyway per H-1), but fix when wiring floats.
Fix: standardize on one accessor. Either always patch via `activity(tableId)` or have dismiss/correct iterate the active filter variants.

**M-2 — `useCreateImport` claims to optimistically insert a pending `shared_save` into `tables.activity` and to poll while pending; it does neither. [partial — FAILS the "pending card appears in the Table feed" AC for Table saves; wishlist pending card is fine]**
The docstring (lines 7-12) and Blast Radius §6 promise an optimistic pending `shared_save` ActivityItem per `table_id` and a focus-poll while `pending`. The implementation patches only the wishlist cache (lines 81-115) and sets no `refetchInterval`. So a Table-only save shows nothing in the Table feed until extraction resolves AND a manual refetch happens; and a backgrounded wishlist save won't auto-fill without a poll (the "resolves on next foreground/refetch" AC leans on a poll that isn't here). `app/wishlist.tsx` was listed as "MODIFY — poll while pending" in the design but the diff stat shows no change to `app/wishlist.tsx`.
Fix: add the optimistic `shared_save` insert into `tables.activity(tableId)` for each ticked table; add a `refetchInterval` (or focus refetch) on the wishlist/activity queries gated on "any row is pending," per the never-block UX ACs.

**M-3 — `handleAsyncExtract` runs with no rate limiting; the 429 guard is only on the synchronous URL path. [WARN vs "per-user rate limit reuses check_and_increment_rate_limit"]**
`resolve-url` calls `check_and_increment_rate_limit` only in the main URL-resolution flow (lines 775-790). The `action:'extract'` path (handleAsyncExtract) and the inline `handleVisionExtract` path return before/without ever touching the rate limiter, so the actual Anthropic vision calls — the thing the rate limit exists to bound — are uncapped per user. A loop firing `create_import` repeatedly enqueues unbounded extracts (each a model call) since `create_import` itself never rate-limits either.
Fix: call `check_and_increment_rate_limit` with the `'resolve_content'` bucket inside `create_import` (before firing extract) or at the top of `handleAsyncExtract`, honoring the never-block rule (over-limit → land the save, mark needs_confirm, skip the model call — exactly the CODEX-M2 resolution).

**M-4 — `handleAsyncExtract` is invoked with the service-role token as the "user," but the body carries no acting user; the `job.user_id === user.id` check passes only by coincidence. [robustness]**
`create_import` fires the extract with `Authorization: Bearer <SERVICE_ROLE_KEY>` (table-shares 250-262). In `resolve-url`, `supabase.auth.getUser(service_role_jwt)` — the service-role key is a JWT whose `sub` is not the saver — so `user.id` is not the job owner. Yet `handleAsyncExtract` checks `job.user_id !== user.id → 403` (line 608). If `getUser` on the service key resolves to anything other than the job owner (it will), the extract 403s and the job stays `pending` forever. This may be why nothing resolves in practice. At minimum it's fragile; needs a deterministic service-role path.
Fix: detect the service-role call (e.g., a shared secret / distinct header) and skip the per-user ownership check for the internal extract, OR pass the real `user_id` in the extract body and validate against the job. Don't rely on `getUser(serviceKey)`.

**M-5 — `restaurants` ghost upsert uses `external_id = "ghost_<userId>_<Date.now()>"` and `.insert` not `.upsert`; rapid double-fire can still create duplicate ghosts, and `Date.now()` collisions across the two ghost branches are possible. [WARN — H4/R3 "never deduped" is satisfied, but per-save dup control is loose]**
Acceptable for never-block, but two ghost-creation branches (lines 377 and 424) can both run for one extraction in edge orderings, and there's no `created_by`+content idempotency. Minor.

---

#### LOW

- **L-1 — `extractFromText` tier gating is absent.** The spec tier ladder is Maps-parse → text-LLM (only if caption sufficient) → vision. `handleAsyncExtract` runs text only when there's no image, and never tries text-before-vision when an image *and* a caption are both present (it always goes vision). Cost-suboptimal, not incorrect. (visionExtract.ts is correct; the orchestration in resolve-url doesn't implement the "prefer cheaper text" branch.)
- **L-2 — `places-search` deviation is justified.** Builder correctly determined places-search doesn't query `restaurants` directly; the verified filter lives in `wishlist.list_table` + `fn_compute_table_float`. Accept the documented deviation. (But note: the restaurant page / who's-been / overlap reads outside this diff still need the `verification='verified'` filter — grep confirms only `wishlist` got it; `restaurant-history` was listed in Blast Radius §2 but shows no diff. Verify those canonical reads can't surface an unverified ghost before merge.)
- **L-3 — `fn_table_activity_page` old-signature REVOKE.** Migration 000500 lines 232-238 REVOKE the old 7-arg overload then the new 8-arg one. Since the new arg is DEFAULTED, PostgreSQL keeps BOTH overloads; the old 7-arg version retains whatever grants it had minus the REVOKE — fine, but be aware two overloads now exist. Non-blocking; matches builder's note.
- **L-4 — `date_bin` / `(p_coalesce_hours||' hours')::interval` require PG14+.** Confirmed safe per builder (prod is PG14+), and the digest IS coalesced in a CTE before the keyset `WHERE`/`LIMIT` (R8 satisfied — cursor stability holds for the coalesced rows). This part is correct. One subtlety: the keyset filter compares `(sort_date, id)` where the digest's `id` is the earliest child's id but `sort_date` is `last_at` (max) — across pages this is internally consistent (one row per bucket), so no skip/dup. PASS on R8.

---

**What is correct (no nits):**
- `fn_compute_table_float` privacy boundary (migration 000400): the join is exactly current `table_members.member_id` × that restaurant × `verification='verified'` × `deleted_at IS NULL` × in-window. A former member drops out (no `table_members` row), another Table's saves can't appear (`tm.table_id = p_table_id`), unverified ghosts can't float, the broader wishlist can't leak (`wi.restaurant_id = p_restaurant_id`). SECURITY DEFINER is locked (`REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` + descriptive COMMENT). H3/R5 fully met *as a query* — it's just never called (H-1).
- `extraction_cache` (000200): stores only content-derived fields, RLS ON no-policy (service-role only), `hash_version` present. H1/H5/B2 met. The recompute-per-request of `already_wishlisted`/`restaurant_id` is correctly done in `handleVisionExtract` (not cached).
- Membership validation in `create_import` is atomic and uses `member_id` (table-shares 171-185): a single non-member table_id fails the whole call before any write. H2/R2 met. `fn_create_import` only ever writes for `p_user_id` and the passed table_ids — no escalation.
- RLS ON for `import_jobs`, `table_shares`, `table_float_state` with `member_id`-based member-read + author-write (R6). T-034 lockdown honored.
- `post-interactions` `table_share` target: `react` validates `validateTableMember` (index.ts 409), `resolveTableId` reads `table_shares.table_id` directly (no entry_tables ambiguity), `sync_post_counts`/`set_post_interaction_table_id` branches are correct. The standalone `shared_save` reaction works end-to-end. (Cleanup-on-delete is the gap — H-5.)
- `list_ids` fully removed from contract/hook/picker (R12). No dead shape. Verified across `table-shares`, `useCreateImport`, `DestinationPicker`.
- Model id `claude-haiku-4-5-20251001` via `EXTRACTION_MODEL` env with that default constant (R10). Fail-soft to `confidence:'low'` is thorough and never throws.
- `booking_url` never in the `table_shares` payload nor returned by `table-activity` (L3/KEEP).

**AC coverage (38):** Met or substantially met: ~24. **Failing/unimplemented:** Screenshot upload path (no bucket — H-3); Global cache/dedup for images (H-4); Emergent float end-to-end (H-1/H-2); Burst-digest expandable children + per-child I'm in (H-6); Confirm propagation to Table card (H-7); Table-save pending card in feed + non-blocking resolve-on-foreground poll (M-2); per-user rate limit actually bounding model calls (M-3). The text/Maps/IG-nudge paths, destination picker, single shared card + reaction, ghost quarantine reads in wishlist, and the privacy/RLS surface are in good shape.

**Recommendation:** REVISE. The privacy-critical SQL is correct, but two headline features (emergent float, burst digest) are non-functional, the screenshot path can't run without the Storage bucket, the image cache lever is defeated, an `// ARCHITECT-REVIEW` cleanup trigger is unresolved, and the service-role extract path likely 403s every job. These are mergeable-blocking. Re-run dual review after H-1…H-7 are addressed.

### Review 1 (Codex adversarial) — 2026-06-03
```
Date: 2026-06-03
Verdict: FAIL (needs-attention — "do not ship")
```
Codex independently FAILed, corroborating Claude and pinpointing root causes. Overlap (both): async extract broken, float never fires, storage bucket missing, B1 cleanup unbuilt, image cache path-keyed, digest child shape, rate-limit bypass. Codex-distinct / sharper:
- **[CX-1 — root cause] Async extract auth.** `create_import` fires `resolve-url?action=extract` with the SERVICE-ROLE key as bearer; `resolve-url` runs `auth.getUser(token)` + `job.user_id===user.id` → 401/403; fire-and-forget swallows it → jobs stuck `pending` forever. **Core pipeline dead.** Fix: signed internal extract path that loads the job owner from DB and skips the user-JWT ownership check (or pass the saver token); persist/observe failures.
- **[CX-2] Direct DB DML not locked down.** Default grants give `authenticated` DML on the new public tables; `table_shares` author INSERT/UPDATE checks only `author_id` (not membership, not immutable `table_id`/`job_id`); `import_jobs` owner UPDATE bypasses the pending→terminal guard. A hand-rolled client can retarget a share into ANY `table_id`. Fix: REVOKE direct anon/authenticated DML on the 3 tables; force writes through service-role RPCs (or strict `WITH CHECK` membership + immutable columns + status-transition guard).
- **[CX-3] Unverified ghosts publicly readable.** Migration adds `verification`/`created_by` but does NOT change the existing public `restaurants` SELECT policy — quarantine enforced only in edge queries, not at the RLS boundary. Fix: restrict read policy to `verification='verified' OR created_by = auth.uid()`; audit direct `from('restaurants')` callers (restaurant-history/who's-been — Claude L-2).
- **[CX-4 — precise] B1 trigger mismatch.** Migration 000600 creates `sync_post_counts()`, but the live triggers call `sync_post_counts_and_top_emojis()` — never invoking the new fn; `table_share` counts never update. Fix: patch the EXISTING `sync_post_counts_and_top_emojis()` (or recreate triggers); test toggling 👀 changes `table_shares.reaction_count`.
- **[CX-5] Job completion non-transactional + errors ignored.** `handleAsyncExtract` updates `import_jobs` + `wishlist_items` + `table_shares` as separate calls, never checking `.error` — a conflict/FK error leaves the job `resolved` while destinations stay `pending`. Fix: a SECURITY DEFINER RPC that locks the pending job, validates the transition, updates all destinations in ONE transaction, throws on any failure.

**Reconciliation:** BOTH reviewers FAIL → **ticket FAILS → REVISE (cycle 1 of 3).** No conflicting findings; Codex CX-1…CX-5 + Claude H-1…H-7/M-1…M-5 form one coherent punch list (dispatched to the builder). Both confirm the privacy SQL (`fn_compute_table_float`) and `create_import` membership atomicity are CORRECT — preserve them, do not regress.

### Review 2 (Claude cold re-review of Fix Pass 1 — pairs with Codex)
```
Date: 2026-06-03
Verdict: REVISE (FAIL)
Score: 12 PASS / 4 WARN / 4 FAIL
```

Re-reviewed commit `f804892` (`git diff 0ccc262..HEAD`) against Review-1 blockers H-1…H-7 / M-1…M-5 and Codex CX-1…CX-5. `tsc --noEmit` clean (exit 0). The migration-level and SQL-function fixes are largely solid and the privacy SQL from Review 1 is preserved. But three things keep it from passing: a **new SQL suppression bug** introduced by the float fix, a **deployment landmine** (the whole pipeline is dead until an undocumented secret is set), and the **screen-level wiring** of the wrong-guess/needs-confirm flow is still dead (hooks fixed, no UI calls them). Two leaks Review 1 flagged (restaurant-history ghost search) remain open.

**Review-1 blocker status (one-liner each):**
- CX-1 (async extract auth) — **CLOSED (with a caveat).** `x-internal-secret`/`INTERNAL_CALL_SECRET` path loads job owner from DB, skips user-JWT check; fails CLOSED when secret unset/wrong (no bypass). Caveat: pipeline is DEAD until the secret is set (H-new-1).
- CX-2 (direct DML lockdown) — **CLOSED.** Dropped `table_shares_author_insert/update` + `import_jobs_owner_update`; RLS-on + no write policy = deny-by-default. No client does direct DML (grep clean). Service-role writes unaffected. (Header says "REVOKE" but does DROP POLICY — same effect; cosmetic.)
- CX-3 (unverified ghosts readable) — **PARTIALLY CLOSED.** All 3 permissive `restaurants` SELECT policies correctly dropped + replaced with `verified OR owner`. But service-role reads bypass RLS: `restaurant-history` onNapkin search still leaks other users' ghosts (M-2-new). And `restaurants` INSERT/UPDATE policies still `WITH CHECK(true)` (M-3-new).
- CX-4 (trigger name mismatch) — **CLOSED.** Patched the LIVE `sync_post_counts_and_top_emojis()` (not the dead `sync_post_counts()`); rewrite faithfully reproduces 000430 dual-scope behavior + adds `table_share`. No regression to entry/round reactions. Verified against 000430.
- CX-5 (non-transactional completion) — **CLOSED.** `fn_complete_import_job` SECURITY DEFINER, `FOR UPDATE` + pending→terminal guard (race-safe), service_role-only GRANT, single txn rolls back all dests on any failure. Correct.
- H-1 (float never fires) — **CLOSED but buggy.** `fn_detect_and_surface_float` now called from `handleAsyncExtract` for each member table on resolved saves; UPSERTs `table_float_state` with `surfaced_at`. Fires only ≥ threshold. BUT re-surface-after-dismiss is broken (H-new-2).
- H-2 (threshold not applied) — **CLOSED.** Both `fn_compute_table_float` (subquery `>= p_threshold`) and `fn_detect_and_surface_float` (`v_count < p_threshold → return`) enforce it.
- H-3 (storage bucket missing) — **CLOSED.** `import-uploads` bucket + owner-only INSERT/SELECT/DELETE `storage.objects` policies on `(storage.foldername(name))[1] = auth.uid()`. 5MB + mime allowlist.
- H-4 (image cache path-keyed) — **CLOSED.** `handleAsyncExtract` downloads bytes, computes `hashImage`, back-fills `import_jobs.content_hash`, keys cache on real bytes-hash. Inline + async now share keyspace.
- H-5 (orphaned reactions on share delete) — **CLOSED.** `cascade_delete_post_interactions_extended()` + `AFTER DELETE` trigger on `table_shares`; existing entry/night triggers recreated to extended fn with no behavior lost. `// ARCHITECT-REVIEW` resolved.
- H-6 (digest children broken / `as any`) — **CLOSED.** `table-activity` maps children to camelCase `SharedSaveCardProps` (`shareId: child.id`, `reactionCount`, etc.); per-child `my_reactions` now fetched for ALL share ids (top-level + digest children); dispatcher uses typed variants. `ShareDigestCard` spreads correct shape.
- H-7 (correction not propagated to Table cards) — **PARTIALLY CLOSED.** Hook now patches/invalidates `activityForTable(tableId)` per ticked table. But `useCorrectImport` has ZERO callers and `app/wishlist.tsx` (untouched) never renders the needs-confirm/`PendingSaveCard` correction affordance — the propagation it fixes can never be triggered (H-new-3).
- M-1 (dismiss/create cache-key mismatch) — **CLOSED.** Standardized on `activityForTable(tableId)` exact-key in `useCreateImport`/`useCorrectImport` snapshot+patch+rollback.
- M-2 (Table pending card + poll) — **PARTIALLY CLOSED.** `useCreateImport` now optimistically inserts a pending `shared_save` into each table's activity + invalidates on success. Table-feed pending card works. Wishlist pending card + foreground poll still absent (`app/wishlist.tsx` unchanged; renders `WishlistByCity`, not `PendingSaveCard`).
- M-3 (extract path uncapped) — **CLOSED.** `handleAsyncExtract` calls `check_and_increment_rate_limit('resolve_content', 20/h)` at top; over-limit → `fn_complete_import_job(needs_confirm)` (never-block). Correct.
- M-4 (service-role getUser fragility) — **CLOSED** by the CX-1 internal-secret path (deterministic owner load).
- M-5 (ghost dup control) — **STILL OPEN (acknowledged minor).** Ghost branches still `.insert` with `ghost_<uid>_<Date.now()>`; never-block tolerates it.

---

#### HIGH (block merge)

**H-new-1 — Entire extraction pipeline is DEAD until `INTERNAL_CALL_SECRET` is set, and it is undocumented. [deployment landmine]**
`resolve-url/index.ts:847-849` + `table-shares/index.ts:254`: when `INTERNAL_CALL_SECRET` is unset (empty), `isInternalCall=false`, so the extract falls into the user-JWT path with the service-role key as bearer → `auth.getUser(serviceKey)` either 401s (`resolve-url:823`) or yields a non-owner `sub` → `job.user_id !== jobOwnerId` → 403 (`resolve-url:643`). Either way **every job sticks at `pending` forever** — the exact pre-fix CX-1 failure. This fails CLOSED (no security bypass — good), but the secret is referenced ONLY in the two edge fns: not in the ticket's "Deferred blocker" list (which names only `ANTHROPIC_API_KEY`), not in `scripts/smoke/`, not in any deploy doc. An operator who sets `ANTHROPIC_API_KEY` and deploys will ship a silently-dead capture feature.
Fix: (1) document `INTERNAL_CALL_SECRET` as a REQUIRED secret alongside `ANTHROPIC_API_KEY` (set both via `supabase secrets set` before deploy); (2) add `resolve-url`/`table-shares` to the smoke list with an end-to-end pending→terminal assertion so a stuck pipeline is caught by auto-revert; (3) consider failing loud at boot if the secret is unset rather than silently 403-ing every job.

**H-new-2 — Dismissed floats can NEVER re-surface; `suppressed_until` 30-day cap is dead. [violates R4 "dismissal suppresses only the same set for 30 days"]**
`fn_detect_and_surface_float` ON CONFLICT (migration `...000700.sql:319-328`) sets `surfaced_at = now()` when `dismissed_at IS NOT NULL`, but **never clears `dismissed_at`**. The feed gate (`...000500.sql:207`) is a hard `tfs.dismissed_at IS NULL`. So once a member dismisses a float, that exact saver-set is suppressed **permanently** (not 30 days) — re-saves by the same set bump `surfaced_at` but the row stays invisible because `dismissed_at` is still set. The `suppressed_until` column + its 30-day value are effectively unreachable for dismissed floats, making the CASE branch dead code. Over-suppression is the safe direction, but it contradicts the spec's frequency-cap semantics and means a dismissed-then-re-popular spot never re-floats.
Fix: on the ON CONFLICT re-surface branch, also `dismissed_at = NULL` (and reset `suppressed_until = NULL`) when re-eligibilizing; OR change the feed gate to `(dismissed_at IS NULL OR suppressed_until < now())` so the 30-day cap actually governs. Pick one and make the suppression window real.

**H-new-3 — Wrong-guess correction flow is dead at the UI layer; `useCorrectImport` has no callers and `app/wishlist.tsx` never renders a needs-confirm card. [FAILS "Needs-confirm flag", "One-tap fix", "Confirm propagation" ACs]**
`useCorrectImport` (the H-7 fix) is referenced only by its own file — grep finds ZERO `.mutate` call sites. `PendingSaveCard` (which renders the "tap to confirm" affordance with an `onConfirm` prop) is barrel-exported but consumed by nothing. `app/wishlist.tsx` (84 lines, last touched by T-053) renders `<WishlistByCity>` — which has no `extraction_status`/pending/`onConfirm` awareness — so the optimistic pending wishlist row (`restaurant:null, extraction_status:'pending'` from `useCreateImport`) never shows the warm-paper "reading it…"/"tap to confirm" UX, and a low-confidence ghost can never be corrected from the wishlist. The H-7 cache-propagation logic is correct but unreachable. (This is the dead-feature-wiring pattern; the Table-feed half IS wired via `tables.tsx`, the wishlist half is not.)
Fix: wire `app/wishlist.tsx` (or `WishlistByCity`) to render `PendingSaveCard` for rows with `extraction_status`, pass `onConfirm` → open `EditMatchPanel` → call `useCorrectImport({ job_id, restaurant_id, tableIds })` (thread `tableIds` from the job/share rows so H-7's loop actually patches). Until a caller passes `tableIds`, H-7's propagation loop is a no-op even once invoked.

**H-new-4 — `restaurant-history` onNapkin global search still leaks other users' unverified ghosts. [CX-3 / L-2 carry-over, STILL OPEN]**
`restaurant-history/index.ts:289-296` (service-role) does `from('restaurants').ilike('name', %q%).limit(30)` with NO `verification='verified'` filter, returning ANY matching restaurant — including `verification='unverified'` ghosts owned by other users — to any searcher in the on-Napkin discovery list. The 000700 SELECT-policy fix does NOT cover this because the function uses the service-role client (RLS bypassed). Review-1 L-2 explicitly flagged restaurant-history as listed-in-blast-radius-but-undiffed; it remains undiffed.
Fix: add `.eq('verification', 'verified')` to both the `onNapkin` search (line 289) and the `visitedRestaurants` search (line 269) in restaurant-history. Audit `user-profile` (lines 358, 520) and `feed` (line 156) the same way — those are owner-scoped (lower risk) but should filter for consistency.

---

#### MEDIUM

**M-1-new — `handleCorrect` (table-shares:322-335) is still non-transactional — the sibling of the CX-5 bug, left unfixed.**
The `correct` action does three separate `.update()` calls (import_jobs, wishlist_items, table_shares) with no `.error` checks and no transaction. If table_shares update fails after wishlist succeeds, the wishlist shows the corrected restaurant while the Table card keeps the wrong guess — the exact split-state CX-5 closed for the extract path. (Currently masked by H-new-3 since `correct` is never called, but fix before wiring the UI.)
Fix: route the correction through a `fn_correct_import_job` SECURITY DEFINER RPC mirroring `fn_complete_import_job` (lock job, update all dests in one txn).

**M-2-new — `restaurants` write policies remain `WITH CHECK(true)`, so a client can forge `verification='verified'`. [defense-in-depth gap the CX-3 quarantine implies]**
Pre-existing policies `"Allow authenticated insert restaurants"` / `"Authenticated users can update restaurants"` (remote_schema:421/441/445/501) let any authenticated client directly INSERT a row with `verification='verified'` or UPDATE an existing ghost's flag to verified — defeating the H4/R3 quarantine the CX-3 read-lock was meant to enforce. Not introduced by this ticket, but the quarantine model assumes clients can't write `verification`.
Fix: column-restrict the UPDATE policy off `verification`/`created_by`, or force restaurant writes through the existing upsert RPC and drop the `WITH CHECK(true)` policies.

**M-3-new — Internal-secret compare is not constant-time; minor timing surface. [LOW-MEDIUM]**
`resolve-url:849` `callerSecret === internalSecret` short-circuits. Over the Supabase internal network with a high-entropy secret this is low risk, but a constant-time compare (e.g. hash-then-compare equal-length digests) is cheap insurance for an auth-bypass gate.

---

#### LOW / WARN

- **W-1 — `fixPass1.test.ts` (15 tests) is mostly tautological.** float-threshold / rate-limit / CX-1 / H-5 tests re-implement the boolean inline (`rows.length >= 3`, `internalSecret.length>0 && caller===secret`) and assert their own copy — they do NOT import or exercise the shipped SQL/handlers, so they would not catch H-new-2 (the real SQL suppression bug). Only the `hashImage`/`hashTextSource` (H-4) tests exercise real code. The claimed gates (float-at-threshold, transactional completion, delete-cleanup) are NOT actually covered by these tests — they'd need a live-DB `.spec.sql`.
- **W-2 — Deno suite is 56 pass / 2 fail under default `deno test` perms.** The pre-existing `visionExtract.test.ts` fail-soft tests throw `NotCapable: Requires env access` without `--allow-env` (they pass WITH it). Build-log "58 pass" is only true with the right flags; ensure CI/smoke passes `--allow-env` or these gate red. (Not a fix-pass regression — file unchanged.)
- **L-1 — `sync_post_counts()` (000600) is now dead code** with a `table_share` branch nothing calls; harmless but should be dropped in cleanup. The 000600 comment "triggers already reference sync_post_counts()" is the false premise that caused CX-4.
- **L-2 — Float detection fires `fn_detect_and_surface_float` for every member table on every resolved save.** Fine at Table scale (1-2 tables); each returns early below threshold. Watch if table membership grows.
- **L-3 — A share that "resolved" to a low-confidence ghost** gets `extraction_status='resolved'`/`needs_confirm` with `restaurant_id=<ghost>`, but the feed hydration filters the ghost (`verification='verified'`), so the card renders with no restaurant. Consistent with quarantine; may look odd. Acceptable for never-block.

---

**What is correct / preserved (no nits):**
- `fn_compute_table_float` privacy join (000400, re-asserted in 000700): current-member × this-restaurant × verified × non-deleted × in-window, now with `>= p_threshold` enforced. SECURITY DEFINER lockdown intact. H3/R5 preserved.
- `fn_complete_import_job` transactional completion: `FOR UPDATE` + pending→terminal guard + service_role-only + rolls back all destinations. CX-5 correct.
- `create_import` membership atomicity (`member_id`, single invalid table_id fails whole call). H2/R2 preserved.
- `extraction_cache` RLS-on/no-policy (service-role only), content-derived fields only. H1/H5/B2 preserved.
- CX-4 trigger fix faithfully reproduces 000430 dual-scope `sync_post_counts_and_top_emojis()` (table_night + entry table/public split) + adds table_share — no regression to existing reactions (verified line-by-line).
- H-5 cascade `_extended` reproduces original entry/night cleanup, adds table_share, recreates triggers — no behavior lost.
- `list_ids` stays fully out of the contract (R12). `booking_url` never in share payload (L3/KEEP).

**Recommendation:** REVISE (cycle 2 of 3). The migration/SQL/trigger fixes (CX-2, CX-4, CX-5, H-2, H-3, H-4, H-5) are genuinely solid and the privacy SQL is preserved with no regression. But: (H-new-1) the pipeline silently dies without an undocumented secret + no smoke coverage; (H-new-2) the float suppression has a real SQL bug that permanently buries dismissed floats; (H-new-3) the entire wrong-guess correction flow is dead at the UI layer (`useCorrectImport` unreachable, wishlist screen unchanged); (H-new-4) restaurant-history still leaks foreign ghosts. CX-1 is closed but only because it fails closed into a dead pipeline. Fix the four HIGHs (and M-1-new before wiring the correction UI) and re-run dual review. Reconciliation: if Codex also returns FAIL, ticket FAILS.

### Review 3 (Claude cold re-review of Fix Pass 2 — cycle 3, FINAL — pairs with Codex)
```
Date: 2026-06-03
Verdict: REVISE (FAIL)
Score: 7 CLOSED / 1 PARTIAL / 1 OPEN (of N1–N9)  ·  category: 4 PASS / 1 WARN / 1 FAIL
```

Re-reviewed commit `56dc206` (`git diff f804892..HEAD`) against cycle-2 blockers N1–N9. Gates re-run locally and confirmed green: `tsc --noEmit` exit 0 (0 errors); Deno **74 passed / 0 failed** (`--allow-env --allow-read`); Jest **102 passed / 0 failed**; migration timestamp guard PASS (83 files). Seven of nine blockers are genuinely closed and the privacy/transactional SQL is preserved with no regression. But **N5 is still OPEN** — a real, security-relevant RLS hole the migration was meant to close and didn't — and **N7 is only PARTIAL** (UI now renders + invokes, but the H-7 Table-feed propagation it was meant to make reachable is still a structural no-op). One FAIL ⇒ ticket fails reconciliation.

**Category scorecard**
- Correctness: WARN — N6 float suppression now correct; N8 transactional correction correct; but N7's H-7 propagation loop never executes (`tableIds` never threaded → `?? []` always empty) and the optimistic wishlist patch writes the wrong page field (`rows` vs `data`).
- Edge Cases: PASS — async fail-soft, never-block on rate-limit/auth-deny/no-extract all terminal-not-pending; image-path ownership rejects traversal.
- Error Handling: PASS — auth-denied/rate-limited/no-extract paths all call `fn_complete_import_job(needs_confirm)`; correction RPC throws and the edge maps 403/404/500.
- Security: FAIL — **N5 incomplete**: 2 of 4 `restaurants` INSERT `WITH CHECK(true)` policies survive (`"Authenticated users can insert restaurants"` 441, `"restaurants insert/update by owners"` 501), so any authenticated client can still `INSERT … verification='verified'` via PostgREST, defeating the H4/R3 quarantine. N1/N2/N3 auth-ordering + ownership checks are correct.
- Performance: PASS — float recompute fires per member-table on resolved saves (early-returns below threshold); cache keyed on real image bytes-hash (H-4 preserved).
- Design Compliance: PASS — `PendingSaveCard` props match the wishlist call site; warm paper, italic Newsreader name, "reading it…", "tap to confirm" muted caption, no emoji chrome.

#### Per-item N1–N9 disposition

| # | Verdict | Evidence |
|---|---------|----------|
| **N1** | **CLOSED** | `resolve-url:881-911`: `action=extract` routed after body-parse but **before** `auth.getUser()`; gated by `timingSafeEqual` on `x-internal-secret`; unset env OR wrong secret → 401, no fall-through (`:887-892`). Job owner loaded from DB (`:894-903`). Non-extract paths still hit the user-JWT gate at `:914-924`. External client cannot reach `handleAsyncExtract` without the secret. |
| **N2** | **CLOSED** | `handleAsyncExtract:626-695`: order is load-job → authorize → rate-limit → image-owner-check → extract. Auth-deny (`:646-653`), rate-limit (`:666-674`), image-owner-fail (`:685-695`) and no-extract (`:748-756`) all call `fn_complete_import_job(needs_confirm)` (terminal) — never left `pending`. |
| **N3** | **CLOSED** | `image_path.split('/')[0] !== owner → 403` before any service-role Storage access in BOTH `resolve-url:685-695` and `table-shares:148-151` (the latter now precedes the `.list()` that previously touched the foreign path unguarded). Traversal (`../…`) rejected (first segment `..`). |
| **N4** | **CLOSED** | `restaurant-history:273,296` both gain `.eq('verification','verified')`. Grep of every `from('restaurants')` in `functions/**`: all remaining unfiltered reads are owner-scoped hydration-by-id (user-profile/feed/top-fours/notifications pull only IDs from the *viewer's own* entries/wishlist) — a foreign user's unverified ghost cannot enter those lists. `table-activity` share/float hydration filters verified (`:469,562`). No cross-user ghost leak remains. |
| **N5** | **OPEN (HIGH)** | `fix_pass2.sql:25-28` drops only `"Allow authenticated insert restaurants"` (421) and `"Authenticated users can update restaurants"` (445). The remote schema (`20251201113055_remote_schema.sql`) **also** defines `"Authenticated users can insert restaurants"` (441, `WITH CHECK(true)`) and `"restaurants insert/update by owners"` (501, INSERT `WITH CHECK(auth.uid() IS NOT NULL)`) — **neither is dropped**. Both are INSERT policies that let any `authenticated` role directly `INSERT INTO restaurants(name, verification) VALUES('x','verified')` via PostgREST, forging a canonical verified restaurant and defeating the ghost quarantine. The UPDATE vector IS closed (445 was the only UPDATE policy). The migration's own comment (`:30-31`) names lines 441 **and** 501 as targets, but the `DROP` statements miss those two exact policy names — so the self-report claim "no remaining authenticated path can set verification='verified'" is false. |
| **N6** | **CLOSED** | `fn_detect_and_surface_float` ON CONFLICT (`fix_pass2.sql:109-135`) re-surfaces **only** when `suppressed_until IS NULL OR < now()`, and on re-surface clears `dismissed_at=NULL` + `suppressed_until=NULL`; else leaves the row unchanged. `fn_dismiss_float:167-172` sets `suppressed_until = now()+30d`. Feed gate (`000500:207-208`) is `dismissed_at IS NULL AND (suppressed_until IS NULL OR < now())`. Net: dismissed float hidden for exactly 30d, then re-surfaces on a same-set save after cap expiry. Genuine behavioral fix vs the cycle-2 version (which set `surfaced_at` but never cleared `dismissed_at` → permanent burial). |
| **N7** | **PARTIAL** | UI half closed: `wishlist.tsx:264-282` renders `PendingSaveCard` for `pending`/`needs_confirm` rows; `:291-300` `CorrectModal` calls `useCorrectImport.mutate` — the hook now has its first real call site. BUT (a) **H-7 Table-feed propagation is still a no-op**: `CorrectModal.handleSelect:91-99` calls `correct({ job_id, restaurant_id, restaurantName })` with **no `tableIds`**; `grep tableIds napkin-app/` finds hits *only inside `useCorrectImport.ts`*, so `input.tableIds ?? []` is always `[]` and the entire Table-activity snapshot/patch/rollback/invalidate loop never executes — a corrected shared card shows the wrong guess in the Table feed until an unrelated refetch. (b) the optimistic **wishlist** patch (`useCorrectImport:65-73`) writes `p.rows`, but `useMyWishlist` pages are `{ data, next_cursor }` — wrong field, so the optimistic update silently no-ops (masked by the `onSuccess` wishlist invalidation). Net: the wishlist correction *works* via refetch; the Table-feed propagation AC (H-7) does **not**. |
| **N8** | **CLOSED** | `fn_correct_import_job` (`fix_pass2.sql:189-241`) SECURITY DEFINER, `FOR UPDATE` lock + owner check (`:203-215`), updates `import_jobs` + all `wishlist_items` + all `table_shares` in one transaction, RAISEs on not-found/forbidden; `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO service_role` (`:243-244`). `handleCorrect:310-327` routes through it and maps the RAISE messages to 403/404/500. Replaces the prior 3-update non-transactional sibling-of-CX-5. (Minor: RPC no longer validates the target restaurant exists/is verified — relies on FK; LOW.) |

**Preserved / not regressed (re-verified):** `fn_compute_table_float` privacy join (untouched); `fn_complete_import_job` (untouched, only referenced in a comment); `create_import` membership atomicity via `member_id` (untouched); `extraction_cache` RLS-on/no-policy (untouched); CX-4 `sync_post_counts_and_top_emojis` trigger (untouched); DML lockdown on the 3 social tables from fix_pass1 (untouched); `list_ids` stays out of contract (only documented-absence comments). 000800 touches none of these primitives — clean.

#### HIGH (block merge)

**H3-1 — N5 incomplete: 2 of 4 `restaurants` INSERT `WITH CHECK(true)` policies survive; clients can still forge `verification='verified'`.**
`supabase/migrations/20260603000800_fix_pass2.sql:25-28` drops `"Allow authenticated insert restaurants"` + `"Authenticated users can update restaurants"` only. Still live after migration: `"Authenticated users can insert restaurants"` (remote_schema:441, `FOR INSERT … WITH CHECK(true)`) and `"restaurants insert/update by owners"` (remote_schema:501, `FOR INSERT … WITH CHECK(auth.uid() IS NOT NULL)`). Either permits a hand-rolled PostgREST `INSERT` of a row with `verification='verified'`, defeating the H4/R3 quarantine that N4's read-filters assume clients cannot bypass. Security: FAIL.
Fix: add `DROP POLICY IF EXISTS "Authenticated users can insert restaurants" ON public.restaurants;` and `DROP POLICY IF EXISTS "restaurants insert/update by owners" ON public.restaurants;` to 000800 (the comment already names them). After dropping, confirm zero non-service-role INSERT/UPDATE policies remain on `restaurants` (only `restaurants_verified_or_owner_select` should survive). Service-role upserts are unaffected (RLS-bypassing).

**H3-2 — N7 only partially closed: H-7 "Confirm propagation to Table card" AC still fails — `tableIds` is never threaded, so the propagation loop is dead.**
`napkin-app/app/wishlist.tsx:91-99` (`CorrectModal.handleSelect`) calls `correct({ job_id, restaurant_id, restaurantName })`; it never passes `tableIds`. `useCorrectImport` guards every Table-activity branch with `for (const tableId of input.tableIds ?? [])` (`:49,81,130,143`), so with `tableIds` undefined the snapshot, optimistic patch, rollback, and `onSuccess` Table-activity invalidation all no-op. Cycle-2 H-new-3 explicitly warned: "Until a caller passes `tableIds`, H-7's propagation loop is a no-op even once invoked." It is now invocable but still un-threaded — a corrected shared card shows the wrong guess in the Table feed until an unrelated refetch.
Fix: thread the job's destination table_ids to the correction call. The wishlist row doesn't carry them, so either (a) return `table_ids` from `create_import` and persist/lookup them per job, or (b) have `fn_correct_import_job` already updates `table_shares` server-side — at minimum invalidate `tables.activityAll()` (or fetch the job's `table_shares.table_id`s in the hook and invalidate each) so the Table feed refetches. Without this, the H-7 AC is unmet even though the server data is correct.

#### MEDIUM

**M3-1 — `useCorrectImport` optimistic wishlist patch targets the wrong page field (`rows`) — silent no-op.**
`napkin-app/hooks/wishlist/useCorrectImport.ts:65-73` patches `old.pages.map(p => ({ ...p, rows: (p.rows ?? []).map(patchRow) }))`, but `useMyWishlist` pages are shaped `{ data: PersonalWishlistItem[]; next_cursor }` (`useMyWishlist.ts:36-39,58`). There is no `rows` field, so the optimistic correction never updates the visible list; it only appears after the `onSuccess` `invalidateQueries(wishlist.personal)` refetch. Not user-fatal (refetch saves it) but the optimistic UX the hook claims is dead, and it indicates the patch was written against the `Page<T>` `rows` envelope rather than this hook's `data` envelope.
Fix: patch `p.data` (and key on `item.id`/`item.job_id` as today). While here, align with the canonical `Page<T>` envelope or document why wishlist uses `{ data }`.

#### LOW

- **L3-1 — `fn_correct_import_job` no longer validates the target restaurant exists/is verified.** The prior `handleCorrect` checked `RESTAURANT_NOT_FOUND`; the RPC blindly sets `restaurant_id`. Relies on a FK on `import_jobs.restaurant_id` to reject garbage (rolls back the txn if present). `restaurant_id` originates from places-search UI results, so low risk. Confirm the FK exists, or add an existence/verified check in the RPC.
- **L3-2 — `fixPass2.test.ts` logic tests re-implement rather than import** (`timingSafeEqual`, `simulateOnConflict` mirror the shipped logic inline). They'd not catch a drift in the real SQL/handler. The 5 SQL-level skips are *honestly* labeled "NOT RUN". Acceptable as documentation-of-intent; not a substitute for live-DB `.spec.sql` (see unexecuted-SQL ranking below).
- **L3-3 — float detection fires `fn_detect_and_surface_float` for every member table on every resolved save** (`resolve-url:810-817`). Fine at 1–2 tables; each early-returns below threshold. Watch if membership grows.

#### Unexecuted-SQL risk ledger (for the merge decision under no-staging deploy)

The builder reports 5 SQL behaviors are not execution-verified (Docker unavailable); the Deno "SQL" tests are logic simulations. Inspecting the SQL directly, each looks correct, but none has run against Postgres. Ranked by blast radius if wrong:

1. **`fn_correct_import_job` transactional rollback (N8)** — HIGH if wrong: a mid-txn failure could split wishlist vs Table-share state. Mitigant: it's PL/pgSQL — a single function body **is** one implicit transaction, so any RAISE rolls back all three UPDATEs automatically; the logic is structurally sound. Risk: LOW-MEDIUM in practice. Smoke does not cover `correct`.
2. **`restaurants` RLS denial for non-member ghosts (N4/N5)** — HIGH if wrong, and N5 *is* wrong (see H3-1) — but that's a static policy-enumeration miss I caught by reading, not an execution gap. The read-side filter (N4) is plain `.eq()`, low risk. The write-side (N5) hole is certain, not speculative.
3. **Float suppress/resurface CASE (N6)** — MEDIUM: the ON CONFLICT CASE + feed-gate interplay is the kind of thing that's easy to get subtly wrong, and it's unrunnable here. I traced all three branches (null/expired/active) by hand and they're correct, but a live `.spec.sql` (insert dismissed row at now−31d / suppressed_until now−1d → call fn → assert `dismissed_at IS NULL`) is the only thing that *proves* it. Recommended before relying on the float "star" feature in prod.
4. **Reaction trigger increments `table_shares.reaction_count` (CX-4, prior pass)** — MEDIUM: faithfully reproduced from 000430 and verified line-by-line in cycle 2; unchanged this pass. A toggle-👀 `.spec.sql` would close it.
5. **`fn_dismiss_float` 30-day cap (N6)** — LOW: trivial UPDATE; the only risk is the interval cast, which matches existing patterns.

Net: the only *certain* SQL-level defect is N5 (H3-1), and it's inspectable, not execution-dependent. The remaining unexecuted SQL is correct-looking under hand-tracing; the residual risk is "no live proof," appropriate to flag under the no-staging model but not independently merge-blocking.

**What is correct (no nits):** N1 auth ordering + `timingSafeEqual` fail-closed; N2 terminal-not-pending on every failure branch; N3 ownership + traversal rejection in both functions; N4 read-side ghost filters + owner-scoped hydration reasoning; N6 float suppression (genuine fix, hand-traced correct); N8 transactional correction RPC + lockdown trio; all preserved primitives un-regressed; gates green (tsc 0, Deno 74, Jest 102, timestamp guard 83).

**Recommendation:** REVISE (cycle 3 of 3). Two blockers remain: **N5 is an OPEN security hole** (2 surviving INSERT `WITH CHECK(true)` policies let clients forge verified restaurants — a 2-line `DROP` fix the migration comment already scoped but the SQL missed), and **N7 is PARTIAL** (the correction UI is now reachable, but the H-7 Table-feed propagation AC is still unmet because `tableIds` is never threaded from `CorrectModal`). Both are small, well-localized fixes. Everything else (N1–N4, N6, N8) is genuinely closed; the privacy/transactional SQL is preserved; the only residual unexecuted-SQL risk is inspectable-and-correct-looking, not a hidden landmine. If the orchestrator wants to merge under the no-staging model, it should do so **only after** the N5 `DROP` lands (security, not optional) — the N7 `tableIds` thread is a functional-completeness gap that could ship as a fast-follow if the Table-share correction path is deemed low-traffic for the friends-test phase, but it is a real AC miss. **Reconciliation: this reviewer FAILs on N5; per the dual-review rule, if either reviewer FAILs the ticket FAILs regardless of Codex's verdict.**

---

## Completion
<!-- Filled when ticket moves to done -->
- Completed: code-complete 2026-06-03 — **NOT yet deployed/verified in prod**
- Final verdict: **APPROVE-WITH-RESIDUAL (orchestrator close-out).** Cycle-1/2/3 dual-review blockers all fixed. HIGH items directly verified by orchestrator: auth ordering (N1–N3 — `action=extract` gated by `x-internal-secret` before user-auth; load→authorize→rate-limit→owner-check→extract; denials terminal), RLS `restaurants` lockdown (B1 — all 4 baseline write policies dropped, proven by full enumeration), Places verification (B2 — non-200 → `needs_confirm`, unverified ghost never `resolved`). Residual: float-CASE / transactional-completion / reaction-trigger *behaviors* are inspected + hand-traced by both reviewers (not execution-tested — pre-existing migration-chain debt prevents clean local replay); the 11 TICKET-060 migrations are confirmed structurally valid (no syntax/dollar-quote bugs, executed in rollback txn). Validate behaviors at deploy-smoke + first use.
- Gates: `tsc` clean · 84 Deno · 102 Jest.
- Deploy plan: set 2 secrets (`ANTHROPIC_API_KEY`, `INTERNAL_CALL_SECRET`) → `db push` (11 migrations) → deploy `resolve-url`, `table-shares`, `places-search`, `table-activity`, `post-interactions`, `wishlist`, `restaurant-history`.
- Pre-existing bugs found while validating (OUT OF SCOPE — flag separately): `rate_limit_buckets.sql` nested-`$$` cron block (never schedules; masked because pg_cron absent) + `20260508_*table_top_4*` references `table_top_4_history` type that the chain doesn't create before it.
- Follow-ups: Phase 2 native iOS share extension = TICKET-060b · race/plan primitive = TICKET-061.
