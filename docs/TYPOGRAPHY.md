# Typography system

Napkin should read at a glance before it feels editorial. Typography carries
that hierarchy:

- **Manrope upright is the functional voice.** Use it for navigation, screen
  titles, section structure, labels, buttons, inputs, metadata, instructions,
  empty states, and status copy.
- **Newsreader upright is the editorial voice.** Use it for restaurant and
  Table names, authored notes, dates, and other content that belongs to a
  person rather than to the interface.
- **Newsreader italic is a rare accent, not the default serif.** Ratings may use
  `Type.ratingCompact`, `Type.rating`, or `Type.ratingLarge`; a direct quote or wordmark needs an
  explicit design decision. Names, labels, prompts, and section headings stay
  upright.

If italics do not communicate a distinct meaning, remove them.

## Semantic type tokens

Prefer a token from `napkin-app/constants/theme.ts` and override layout or
color locally. Do not recreate the token with a literal family and size.

| Intent | Token | Minimum size |
| --- | --- | ---: |
| Primary body copy | `Type.body` | 16 |
| Secondary body copy | `Type.bodySmall` | 14 |
| Caption | `Type.caption` | 13 |
| Metadata | `Type.metadata` | 13 |
| Label | `Type.label` | 11 |
| Compact label | `Type.labelSmall` | 11 |
| Section kicker | `Type.sectionKicker` | 11 |
| Section heading | `Type.sectionTitle` | 18 |
| Screen masthead | `Type.screenTitle` | 20 |
| Editorial title | `Type.editorialTitle` | 20 |
| Editorial body | `Type.editorialBody` | 17 |
| Inline numeric rating accent | `Type.ratingCompact` | 16 |
| Standalone numeric rating accent | `Type.rating`, `Type.ratingLarge` | 24, 36 |

These are floors, not targets for making every surface the same size. A clear
screen still needs contrast between masthead, section, body, and metadata.
Letter spacing, weight, surrounding space, and surface shifts should make the
start of a section obvious without shrinking its supporting text.

Own Profile and table-scoped member Profile have the strictest enforcement
because they are high-density scanning surfaces:

- no `fontStyle: 'italic'`;
- no `Type.headlineItalic`;
- `Type.ratingCompact`, `Type.rating`, and `Type.ratingLarge` only style a named
  numeric render: own Profile's `Rating` value or `TablePreviewCard`
  `preview.avg`, plus member Profile's average stat, top-entry rating, or
  recent-activity rating; never adjacent copy;
- no direct italic family except the numeric rating styles in
  `RatingHistogram.avg`, `RatingHistogram.spineNum`, `MarqueePlate.rating`, and
  `MarqueePlate.ratingPhoto`;
- no literal `fontSize` below 11.

The exceptions are intentionally named style slots. They do not extend to a
restaurant name, rank, city, suffix, kicker, or label next to the rating.

## Color and contrast

Normal-size text must meet WCAG AA contrast of at least **4.5:1**. The automated
guard checks `textMuted` in both color schemes against every paper layer used by
Profile metadata: `background`, all three `surfaceContainer` levels, `card`, and
all six Top-4 plate tints.

Do not lower contrast to make text feel secondary. Establish hierarchy with
semantic size, weight, spacing, and placement first. Text over photography or
translucent overlays still needs manual checking because its effective
background is content-dependent.

## Automated guard

Run the checker from the repository root:

```bash
npm run check:typography
```

It has two enforcement layers:

1. Own- and member-Profile rules, semantic token floors, and muted-text
   contrast are hard gates with no baseline escape hatch. The theme also has an
   explicit italic-token allowlist, so a newly named semantic token cannot
   bypass the app-wide debt guard.
2. Existing direct italic and sub-11pt literal usage elsewhere in
   `napkin-app/app` and `napkin-app/components` is recorded per file in
   `scripts/typography-baseline.json`. Counts may fall but may not rise. A new
   file has a zero debt budget. The named Profile rating slots are intentional
   policy exceptions and are not counted as legacy debt.

After an intentional cleanup, bank the reduction:

```bash
npm run check:typography -- --update-baseline
git diff -- scripts/typography-baseline.json
```

Review the baseline diff like source code. Never update it merely to make a new
violation pass. The update command only changes the incremental debt budget;
it still reports and fails Profile or theme hard-gate violations.

For a genuinely new italic accent, prefer an existing semantic token. If no
token expresses the meaning, the design review should decide whether a new
central semantic token is warranted before any baseline changes.

## Staged migration

The app contains older literal styling, so migration is deliberate rather than
a blind global replacement:

1. **Profile first:** keep own and table-scoped member identity, taste, rating,
   activity, and index stacks fully compliant with the strict rules.
2. **Stop growth:** the per-file baseline prevents new direct italic or tiny
   literal debt across visible app and component code.
3. **Improve touched surfaces:** when changing a screen, replace its literals
   with semantic tokens and verify the hierarchy in context. Reductions are
   always safe for the checker.
4. **Bank cleanup:** refresh and review the baseline after the focused change so
   removed debt cannot quietly return.
5. **Retire legacy tokens:** once `Type.headlineItalic` has no callers, remove it
   in a dedicated cleanup rather than repurposing it.

Do not perform an app-wide mechanical font swap without screen-by-screen visual
verification. Italic removal often changes width, line breaks, and perceived
spacing even when the numeric size is unchanged.

## Manual Dynamic Type screenshot matrix

Automated floors cannot prove glanceability, wrapping, truncation, or section
separation. For typography changes, capture this matrix in the enabled light
appearance. `use-color-scheme.ts` currently forces light mode; repeat the same
matrix in dark when dark appearance is enabled. Use realistic long names and
non-empty data; also check the empty state.

| Surface / state | Default | Large | Accessibility XL |
| --- | --- | --- | --- |
| Own Profile: full overview stack | Section boundaries and first scan path are obvious | Body and metadata remain readable without collisions | Content reflows; no hidden controls or overlapping sections |
| Another person's Profile: long name, bio, counts | Name, relationship action, and stats have distinct hierarchy | Long identity copy wraps without clipping actions | Reading order stays coherent after wrapping |
| Table member Profile: long name, taste summary, stats, activity | Identity, at-a-glance stats, top entries, and recent activity have distinct hierarchy | Names wrap while ratings and metadata remain readable | Row controls remain reachable and sections stay distinct after wrapping |
| Profile rating histogram and taste modules | Rating remains the only italic accent | Axis, labels, and values remain distinguishable | Chart labels do not overlap or become the sole source of meaning |
| Profile index and one populated drill-in | Row title, count, and supporting metadata separate cleanly | Rows grow rather than truncate essential text | Tap targets and disclosure affordances remain reachable |
| Profile sheet/modal and empty/error state | Instruction and action are immediately legible | Sheet title and actions do not collide with the viewport | Content scrolls; confirmation actions are not pushed off-screen |

Repeat the matrix on a compact iPhone viewport and a current large iPhone. At
minimum, use a 375pt-wide compact viewport and a 430pt-wide large viewport.
Check the screenshots at normal viewing scale rather than zooming in: the goal
is immediate comprehension, not merely technically visible glyphs.

Record any deliberate truncation, fixed-size exception, or disabled font
scaling in the PR. Essential text must not depend on a fixed viewport or the
default Dynamic Type setting.
