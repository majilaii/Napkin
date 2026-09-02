/**
 * Napkin Design System — "The Private Ledger"
 *
 * Inspired by high-end food journals and bespoke stationery.
 * Fonts: Newsreader (editorial serif) + Manrope (functional sans)
 * Palette: organic earth tones — terracotta, olive, amber on warm cream
 *
 * Rules:
 * - No 1px solid borders for sectioning. Use background shifts + spacing.
 * - No pure black. Use on-surface (#1c1c19).
 * - No standard review stars. Use sliders or descriptive text.
 * - Ambient shadows only (6% opacity, 30px blur).
 */

import { Platform, TextStyle } from 'react-native';

export const Colors = {
  light: {
    // Surfaces (stacked vellum layers — warm amber)
    background: '#fdf6ec',           // Layer 1: The Table (warm cream page)
    surface: '#fdf6ec',
    surfaceContainer: '#f6ecdb',     // Layer 2: The Journal (amber vellum)
    surfaceContainerLow: '#faf0e0',  // soft cream
    surfaceContainerHigh: '#efe2ce', // deeper cream (overlap bubbles)
    card: '#fffdf8',                 // Layer 3: The Note (warm white)
    cardElevated: '#fffdf8',
    surfaceNote: '#fffdf8',          // alias: --surface-note
    surfaceJournal: '#f6ecdb',       // alias: --surface-journal
    surfaceJournalLow: '#faf0e0',    // alias: --surface-journal-low
    surfaceJournalHi: '#efe2ce',     // alias: --surface-journal-hi

    // Text
    text: '#1c1c19',                 // on-surface (never pure black)
    textSecondary: '#5c614d',        // olive secondary
    textSoft: '#55534b',             // editorial supporting copy (feed mock --ink-soft)
    // Warm taupe metadata. Dark enough to clear 4.5:1 on every paper layer and
    // Top-4 plate tint used by normal-size text in light mode.
    textMuted: '#765e58',
    textFaint: '#98917f',            // datelines + quiet ledger metadata
    textInverse: '#ffffff',

    // Brand — terracotta family
    primary: '#a03f28',              // terracotta
    primaryContainer: '#c0573e',     // lighter terracotta
    primaryMuted: 'rgba(160, 63, 40, 0.08)',
    // Compact map-caption actions. These are deliberately separate from
    // primaryMuted: the founder-approved peek uses a precise 9% CTA wash and a
    // quieter 6% selected-heart wash without changing other surfaces.
    mapPeekPrimaryWash: 'rgba(160, 63, 40, 0.09)',
    mapPeekSavedWash: 'rgba(160, 63, 40, 0.06)',
    terracottaWarm: '#c0573e',       // --terracotta-warm
    terracottaDeep: '#7c2d12',       // --terracotta-deep
    terracottaInk: '#9a3412',        // --terracotta-ink (nib-stroke)
    terracottaScrim: 'rgba(160, 63, 40, 0.05)',
    terracottaBorder: 'rgba(160, 63, 40, 0.10)',
    terracottaBorderStrong: 'rgba(160, 63, 40, 0.35)', // outline pills (invite / follow CTAs)

    // Secondary — olive
    secondary: '#5c614d',            // olive
    secondaryContainer: '#e0e5cc',   // olive cream
    oliveCream: '#e0e5cc',           // alias

    // Tertiary — amber family (ratings + chips)
    tertiary: '#825516',             // amber
    tertiaryFixed: '#ffddb9',        // amber-cream chip bg
    amberInk: '#663e00',             // deep amber text
    amberOnCream: '#2b1700',         // near-black on amber
    amberBright: '#d97706',          // inline rating numerals
    amberChipHi: '#ffedd5',          // warmer amber

    // Sanguine — Round / visit-count accent
    sanguine: '#8a2a1a',
    sanguineOnCream: '#fef6e6',       // cream text on sanguine bg

    // Cream — ambient backgrounds on elevated/hero surfaces
    cream: '#f6ecd9',

    // Plate tints (TICKET-146 engraving system) — 6 warm tonal creams for the
    // Top-4 marquee plates + future crest. Assigned by tintFor(restaurant_id).
    // Never per-item; stay in the warm-paper family.
    plateAmber: '#f4e6cd',
    plateOlive: '#e6ead5',
    plateRose: '#f2e3da',
    plateGrey: '#eae6dc',
    plateSlate: '#e3e8e4',
    plateSand: '#f0e8d6',

    // Overlay variants
    overlayPhoto: 'rgba(0, 0, 0, 0.35)',
    overlayHeavy: 'rgba(0, 0, 0, 0.6)',
    scrimFrost: 'rgba(252, 249, 244, 0.92)',
    scrimCream: 'rgba(246, 236, 217, 0.85)',

    // Functional
    star: '#b8842a',                 // amber for inline stars (brighter fill)
    success: '#5c614d',              // olive
    error: '#ba1a1a',
    tint: '#a03f28',

    // UI
    icon: '#5c614d',
    tabIconDefault: '#5c614d',
    tabIconSelected: '#a03f28',
    outline: '#8a726c',
    outlineVariant: '#ddc0ba',
    divider: 'rgba(221, 192, 186, 0.15)', // warm rule (pale rose)
    ghostRule: 'rgba(28, 28, 25, 0.09)',  // feed masthead/tail rule
    dividerSoft: 'rgba(221, 192, 186, 0.30)', // softer variant (feed row dividers)
    imageOutline: 'rgba(0, 0, 0, 0.10)', // neutral inset edge on photography
    ruleWarmNib: 'rgba(221, 192, 186, 1)',  // full pale-rose rule
    overlay: 'rgba(28, 28, 25, 0.4)',
    border: 'rgba(221, 192, 186, 0.15)',   // alias for compat
    ruleInkSoft: 'rgba(138, 114, 108, 0.25)',  // --rule-ink-soft — warm taupe, field underline resting

    // TICKET-057 — warm-paper wash on Places-sourced hero photos.
    // Reads as "external context, seen through cream vellum" — quieter than a
    // user/Table photo. Used ONLY by RestaurantHero when photo_source === 'places'.
    placesOverlayTint: '#fdf6ec',     // light: matches `background` (cream)
    placesOverlayOpacity: 0.22,       // 22% — calmer than a scrim, visible side-by-side

    // TICKET-046 — image overlay tokens for Top 4 tile labels.
    // scrimDark: photo gradient overlay (on-photo text backgrounds).
    // textOnImage: light text rendered over photo tiles.
    scrimDark: 'rgba(28, 28, 25, 0.35)',  // on-surface at 35% — warmer than pure black
    textOnImage: '#FFFEF8',               // warm near-white for text on photo tiles
  },
  dark: {
    background: '#1a1816',
    surface: '#1a1816',
    surfaceContainer: '#252220',
    surfaceContainerLow: '#201e1c',
    surfaceContainerHigh: '#2a2724',
    card: '#2a2724',
    cardElevated: '#302c28',
    surfaceNote: '#2a2724',
    surfaceJournal: '#252220',
    surfaceJournalLow: '#201e1c',
    surfaceJournalHi: '#2a2724',

    text: '#f3f0eb',
    textSecondary: '#c4c9b1',
    textSoft: '#d0cbc1',
    textMuted: '#a09888',
    textFaint: '#8e8779',
    textInverse: '#1a1816',

    primary: '#ffb4a3',
    primaryContainer: '#812914',
    primaryMuted: 'rgba(255, 180, 163, 0.12)',
    mapPeekPrimaryWash: 'rgba(255, 180, 163, 0.12)',
    mapPeekSavedWash: 'rgba(255, 180, 163, 0.09)',
    terracottaWarm: '#d4766a',
    terracottaDeep: '#ff7a5a',
    terracottaInk: '#ff967d',
    terracottaScrim: 'rgba(255, 180, 163, 0.06)',
    terracottaBorder: 'rgba(255, 180, 163, 0.12)',
    terracottaBorderStrong: 'rgba(255, 180, 163, 0.35)', // outline pills (invite / follow CTAs)

    secondary: '#c4c9b1',
    secondaryContainer: '#444937',
    oliveCream: '#444937',

    tertiary: '#f8bb73',
    tertiaryFixed: '#663e00',
    amberInk: '#ffd9a8',
    amberOnCream: '#ffd9a8',
    amberBright: '#ffb547',
    amberChipHi: '#7a4a12',

    sanguine: '#d4766a',
    sanguineOnCream: '#fff0e0',

    cream: '#3a3025',

    // Plate tints (TICKET-146) — muted dark equivalents, same order as light.
    plateAmber: '#2f2a22',
    plateOlive: '#282c22',
    plateRose: '#2e2724',
    plateGrey: '#272420',
    plateSlate: '#232825',
    plateSand: '#2c2820',

    overlayPhoto: 'rgba(0, 0, 0, 0.5)',
    overlayHeavy: 'rgba(0, 0, 0, 0.75)',
    scrimFrost: 'rgba(26, 24, 22, 0.92)',
    scrimCream: 'rgba(37, 34, 32, 0.85)',

    star: '#f8bb73',
    success: '#c4c9b1',
    error: '#ffb4ab',
    tint: '#f3f0eb',

    icon: '#c4c9b1',
    tabIconDefault: '#605850',
    tabIconSelected: '#ffb4a3',
    outline: '#a09888',
    outlineVariant: '#56423d',
    divider: 'rgba(86, 66, 61, 0.3)',
    ghostRule: 'rgba(243, 240, 235, 0.09)',
    dividerSoft: 'rgba(86, 66, 61, 0.45)',
    imageOutline: 'rgba(255, 255, 255, 0.10)', // neutral inset edge on photography
    ruleWarmNib: 'rgba(86, 66, 61, 1)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    border: 'rgba(86, 66, 61, 0.3)',
    ruleInkSoft: 'rgba(200, 140, 120, 0.20)',  // soft terracotta rule lines (dark)

    // TICKET-057 — warm-paper wash on Places-sourced hero photos (dark mode).
    // Dark cream matches the dark `cream` token (#3a3025) for consistency.
    placesOverlayTint: '#3a3025',     // dark: matches `cream` token
    placesOverlayOpacity: 0.22,       // 22% — same opacity as light mode

    // TICKET-046 — image overlay tokens for Top 4 tile labels (dark mode).
    scrimDark: 'rgba(0, 0, 0, 0.50)',  // darker scrim over dark-mode photos
    textOnImage: '#F3F0EB',            // warm off-white — matches dark `text` token
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  /** Founder-approved compact Friends-feed rhythm (TICKET-226). */
  feed: {
    stackGap: 1,
    avatarOffset: 2,
    footerIconGap: 5,
    metaGap: 6,
    stripGap: 6,
    rowTop: 8,
    cardHeaderGap: 8,
    mediaTop: 9,
    ledgerVertical: 9,
    footTop: 9,
    rowBottom: 10,
    contentGap: 10,
    cardMargin: 10,
    cardTop: 12,
    cardHorizontal: 14,
    quoteLead: 2,
  },
  /** Founder-approved restaurant v3 page and ledger rhythm (TICKET-227/222). */
  restaurant: {
    pageGutter: 20,
    topBarGutter: 10,
    topBarHeight: 52,
    sectionGap: 26,
    doorwaySectionGap: 22,
    mastheadTop: 4,
    numbersTop: 18,
    numbersVertical: 14,
    actionTop: 18,
    actionGap: 10,
    compactGap: 6,
    hairlineGap: 1,
    cardHorizontal: 14,
    cardVertical: 13,
    sectionHeadingHeight: 40,
    quietActionHeight: 44,
    primaryActionHeight: 48,
    spreadHeight: 64,
    spreadBarMin: 4,
    spreadBarGap: 5,
    spreadFooterTop: 6,
    spreadBarRadius: 3,
    listChipHorizontal: 12,
    ledgerGap: 10,
    ledgerEmptyTop: 100,
    ledgerEmptyGutter: 40,
    ledgerPhotoSize: 64,
  },
  /** Shared sheet chrome; detent geometry remains component-owned. */
  sheet: {
    handleWidth: 36,
    handleHeight: 4,
    handleTop: 8,
    handleBottom: 6,
  },
} as const;

export const Radius = {
  sm: 4,     // scrapbook clips, chips
  compact: 8, // compact feed media + thumbnails
  md: 12,
  lg: 16,    // text cards, notes
  xl: 24,
  xxl: 28,   // feed hero cards
  xxxl: 32,  // large hero bubbles
  full: 9999,
} as const;

export const IconSize = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
  xxl: 32,
} as const;

/** Ambient shadow — soft glow, not hard drop */
export const Shadow = {
  ambient: {
    shadowColor: '#1c1c19',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 30,
    elevation: 3,
  },
  /** --shadow-note — for white notes */
  note: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.03,
    shadowRadius: 30,
    elevation: 2,
  },
  /** --shadow-clip — photo clip */
  clip: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  /** --shadow-nav — bottom nav blur */
  nav: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.04,
    shadowRadius: 30,
    elevation: 4,
  },
  subtle: {
    shadowColor: '#1c1c19',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 1,
  },
} as const;

/**
 * Typography presets
 * Newsreader upright = editorial voice (names, authored content, dates)
 * Manrope upright = functional voice (body, labels, captions, structure)
 * Newsreader italic = scarce accent (ratings, direct quotes, wordmark)
 *
 * Legibility floor for functional text: 16 body, 13 metadata, 11 labels.
 * Smaller type is only appropriate for non-essential text embedded in art.
 */
export const Type = {
  // Display — Newsreader serif, editorial
  displayLarge: {
    fontSize: 42,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular',
    letterSpacing: -1,
    lineHeight: 46,
  } as TextStyle,
  displayMedium: {
    fontSize: 32,
    fontWeight: '700' as const,
    fontFamily: 'Newsreader_700Bold',
    letterSpacing: -0.5,
    lineHeight: 36,
  } as TextStyle,
  displaySmall: {
    fontSize: 24,
    fontWeight: '600' as const,
    fontFamily: 'Newsreader_600SemiBold',
    letterSpacing: -0.3,
    lineHeight: 28,
  } as TextStyle,

  // Headlines — Newsreader for editorial items
  headlineLarge: {
    fontSize: 28,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular',
    lineHeight: 34,
  } as TextStyle,
  headlineMedium: {
    fontSize: 20,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular',
    lineHeight: 26,
  } as TextStyle,
  headlineItalic: {
    fontSize: 18,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 24,
  } as TextStyle,

  // Editorial content — upright by default. Italics should communicate a
  // specific accent, not merely "this is serif".
  editorialTitle: {
    fontSize: 20,
    fontWeight: '600' as const,
    fontFamily: 'Newsreader_600SemiBold',
    letterSpacing: -0.2,
    lineHeight: 26,
  } as TextStyle,
  /** Founder-approved compact map-caption restaurant name. */
  mapPeekName: {
    fontSize: 21,
    fontWeight: '600' as const,
    fontFamily: 'Newsreader_600SemiBold',
    letterSpacing: -0.28,
    lineHeight: 24,
  } as TextStyle,
  editorialBody: {
    fontSize: 17,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular',
    lineHeight: 24,
  } as TextStyle,
  // Exact first-person words shown as authored quotes. Keep this scarce: it is
  // not a substitute for the upright editorial body style.
  quote: {
    fontSize: 16,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 21,
  } as TextStyle,

  // Section structure — deliberately sans, upright, and large enough to make
  // the beginning of each module obvious while scanning.
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: -0.2,
    lineHeight: 24,
  } as TextStyle,
  sectionKicker: {
    fontSize: 11,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1.2,
    lineHeight: 15,
    textTransform: 'uppercase' as const,
  } as TextStyle,
  feedSectionKicker: {
    fontSize: 11,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1.54,
    lineHeight: 15,
    textTransform: 'uppercase' as const,
  } as TextStyle,
  dateline: {
    fontSize: 11,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    letterSpacing: 1.54,
    lineHeight: 15,
    textTransform: 'uppercase' as const,
  } as TextStyle,
  metadata: {
    fontSize: 13,
    fontWeight: '500' as const,
    fontFamily: 'Manrope_500Medium',
    lineHeight: 19,
  } as TextStyle,
  /** Compact Friends-feed metadata, bylines, and relative timestamps. */
  feedMeta: {
    fontSize: 13,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    lineHeight: 19,
  } as TextStyle,
  feedMetaStrong: {
    fontSize: 13,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    lineHeight: 19,
  } as TextStyle,
  feedNoteRestaurant: {
    fontSize: 16,
    fontWeight: '500' as const,
    fontFamily: 'Newsreader_500Medium',
    lineHeight: 21,
  } as TextStyle,
  feedCardRestaurant: {
    fontSize: 17,
    fontWeight: '500' as const,
    fontFamily: 'Newsreader_500Medium',
    lineHeight: 22,
  } as TextStyle,
  feedNoteRating: {
    fontSize: 16,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 21,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  feedCardRating: {
    fontSize: 17,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 22,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  feedQuote: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 20,
  } as TextStyle,
  feedLedger: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular',
    lineHeight: 19,
  } as TextStyle,
  feedLedgerRating: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  feedPhotoCount: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    lineHeight: 19,
  } as TextStyle,
  /** Compact map-caption metadata and relationship line. */
  mapPeekMeta: {
    fontSize: 13,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    lineHeight: 18,
  } as TextStyle,
  mapPeekDetailStrong: {
    fontSize: 13,
    fontWeight: '800' as const,
    fontFamily: 'Manrope_800ExtraBold',
    lineHeight: 18,
  } as TextStyle,
  mapPeekAction: {
    fontSize: 13,
    fontWeight: '800' as const,
    fontFamily: 'Manrope_800ExtraBold',
    lineHeight: 18,
    letterSpacing: 0.05,
  } as TextStyle,

  // TICKET-227/222 — one restaurant-page grammar. These names prevent the
  // founder-approved v3 scale from drifting through local style overrides.
  restaurantName: {
    fontSize: 34,
    fontWeight: '600' as const,
    fontFamily: 'Newsreader_600SemiBold',
    letterSpacing: -0.4,
    lineHeight: 38,
  } as TextStyle,
  restaurantKicker: {
    fontSize: 11,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1.2,
    lineHeight: 15,
    textTransform: 'uppercase' as const,
  } as TextStyle,
  restaurantPrimaryAction: {
    fontSize: 13,
    fontWeight: '800' as const,
    fontFamily: 'Manrope_800ExtraBold',
    letterSpacing: 0.6,
    lineHeight: 19,
  } as TextStyle,
  restaurantUtilityAction: {
    fontSize: 13,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    lineHeight: 19,
  } as TextStyle,
  restaurantDoorway: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    lineHeight: 22,
  } as TextStyle,
  restaurantSectionAction: {
    fontSize: 13,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    lineHeight: 19,
  } as TextStyle,
  restaurantQuote: {
    fontSize: 16,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 22,
  } as TextStyle,
  restaurantQuoteName: {
    fontSize: 13,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    lineHeight: 19,
  } as TextStyle,
  restaurantRatingInline: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    lineHeight: 19,
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  restaurantListTitle: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular',
    lineHeight: 19,
  } as TextStyle,
  restaurantDetail: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    lineHeight: 20,
  } as TextStyle,
  restaurantDetailAction: {
    fontSize: 13,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    lineHeight: 19,
  } as TextStyle,

  // Titles — Manrope for functional
  /**
   * Screen/page masthead — Manrope, NOT italic serif (locked 2026-07-10).
   * Upright Newsreader is the editorial voice for names and authored content;
   * italic Newsreader is reserved for rating numerals, quotes, and the wordmark.
   * Navigation chrome is functional and reads in sans.
   */
  screenTitle: {
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: -0.3,
  } as TextStyle,
  feedTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: -0.26,
  } as TextStyle,
  titleLarge: {
    fontSize: 19,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: -0.2,
  } as TextStyle,
  titleMedium: {
    fontSize: 17,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
  } as TextStyle,
  titleSmall: {
    fontSize: 15,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
  } as TextStyle,

  // Body — Manrope
  body: {
    fontSize: 16,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    lineHeight: 24,
  } as TextStyle,
  bodySmall: {
    fontSize: 14,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    lineHeight: 20,
  } as TextStyle,

  // Labels — Manrope uppercase
  label: {
    fontSize: 12,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1.3,
    lineHeight: 16,
    textTransform: 'uppercase' as const,
  } as TextStyle,
  labelSmall: {
    fontSize: 11,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: 1.1,
    lineHeight: 15,
    textTransform: 'uppercase' as const,
  } as TextStyle,

  // Caption
  caption: {
    fontSize: 13,
    fontWeight: '500' as const,
    fontFamily: 'Manrope_500Medium',
    lineHeight: 18,
  } as TextStyle,

  // Rating numbers — the only routine italic accent. Keep the compact token
  // for inline diary metadata; use the larger tokens for standalone values.
  ratingCompact: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  rating: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    fontVariant: ['tabular-nums'],
  } as TextStyle,
  ratingLarge: {
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
    fontVariant: ['tabular-nums'],
  } as TextStyle,
};

// Keep Fonts export for backwards compat
export const Fonts = Platform.select({
  ios: { sans: 'Manrope_400Regular', serif: 'Newsreader_400Regular', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'Manrope_400Regular', serif: 'Newsreader_400Regular', rounded: 'normal', mono: 'monospace' },
});
