---
id: TICKET-094
title: "Search should find lists"
priority: medium
status: backlog
created: 2026-07-04
updated: 2026-07-04
tags: [search, lists]
---

# Search should find lists

## Problem

Search finds restaurants (Places + persisted tiers) and people — but not lists. The founder wants lists findable: "which of my lists has that ramen place?" or just typing a list's name and landing on it. Lists are a curation surface that currently has no retrieval surface besides scrolling the wishlist tab.

## Notes

### Current state

- All of a user's lists load client-side via `useMyLists` (no pagination — the full set is already in memory on the wishlist tab).
- The search tab is tiered for restaurants (Your Tables / On Napkin / More places) plus a People mode.

### Options

- **(A) Client-side filter of `useMyLists`** by title/description, surfaced as a "your lists" section in search results. Near-zero cost, works offline, no new endpoint. **Recommended v1.**
- **(B) Server action `lists?action=search`** matching titles AND entry restaurant names ("which of my lists has Kono?"). The genuinely useful deep match. Needs a small edge action + `ilike` join through `list_entries → restaurants`.
- **(C) Public-list discovery across other users** — explicitly deferred to TICKET-093 public-visibility semantics. Do not build.

### Recommendation

A now, B when lists grow, C blocked on 093.

No spec yet — needs a decision on whether matching list CONTENTS (B) is v1.
