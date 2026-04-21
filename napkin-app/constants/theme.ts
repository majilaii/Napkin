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
    textMuted: '#8a726c',            // warm taupe metadata
    textInverse: '#ffffff',

    // Brand — terracotta family
    primary: '#a03f28',              // terracotta
    primaryContainer: '#c0573e',     // lighter terracotta
    primaryMuted: 'rgba(160, 63, 40, 0.08)',
    terracottaWarm: '#c0573e',       // --terracotta-warm
    terracottaDeep: '#7c2d12',       // --terracotta-deep
    terracottaInk: '#9a3412',        // --terracotta-ink (nib-stroke)
    terracottaScrim: 'rgba(160, 63, 40, 0.05)',
    terracottaBorder: 'rgba(160, 63, 40, 0.10)',

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
    dividerSoft: 'rgba(221, 192, 186, 0.30)', // softer variant (feed row dividers)
    ruleWarmNib: 'rgba(221, 192, 186, 1)',  // full pale-rose rule
    overlay: 'rgba(28, 28, 25, 0.4)',
    border: 'rgba(221, 192, 186, 0.15)',   // alias for compat
    ruleInkSoft: 'rgba(138, 114, 108, 0.25)',  // --rule-ink-soft — warm taupe, field underline resting
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
    textMuted: '#a09888',
    textInverse: '#1a1816',

    primary: '#ffb4a3',
    primaryContainer: '#812914',
    primaryMuted: 'rgba(255, 180, 163, 0.12)',
    terracottaWarm: '#d4766a',
    terracottaDeep: '#ff7a5a',
    terracottaInk: '#ff967d',
    terracottaScrim: 'rgba(255, 180, 163, 0.06)',
    terracottaBorder: 'rgba(255, 180, 163, 0.12)',

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
    dividerSoft: 'rgba(86, 66, 61, 0.45)',
    ruleWarmNib: 'rgba(86, 66, 61, 1)',
    overlay: 'rgba(0, 0, 0, 0.6)',
    border: 'rgba(86, 66, 61, 0.3)',
    ruleInkSoft: 'rgba(200, 140, 120, 0.20)',  // soft terracotta rule lines (dark)
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const Radius = {
  sm: 4,     // scrapbook clips, chips
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
 * Newsreader = editorial voice (restaurant names, ratings, dates)
 * Manrope = functional voice (body, labels, captions)
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

  // Titles — Manrope for functional
  titleLarge: {
    fontSize: 18,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: -0.2,
  } as TextStyle,
  titleMedium: {
    fontSize: 16,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
  } as TextStyle,
  titleSmall: {
    fontSize: 14,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
  } as TextStyle,

  // Body — Manrope
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    lineHeight: 22,
  } as TextStyle,
  bodySmall: {
    fontSize: 13,
    fontWeight: '400' as const,
    fontFamily: 'Manrope_400Regular',
    lineHeight: 18,
  } as TextStyle,

  // Labels — Manrope uppercase
  label: {
    fontSize: 11,
    fontWeight: '700' as const,
    fontFamily: 'Manrope_700Bold',
    letterSpacing: 1.5,
    textTransform: 'uppercase' as const,
  } as TextStyle,
  labelSmall: {
    fontSize: 9,
    fontWeight: '600' as const,
    fontFamily: 'Manrope_600SemiBold',
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
  } as TextStyle,

  // Caption
  caption: {
    fontSize: 12,
    fontWeight: '500' as const,
    fontFamily: 'Manrope_500Medium',
  } as TextStyle,

  // Rating numbers — Newsreader italic for artisanal feel
  rating: {
    fontSize: 24,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
  } as TextStyle,
  ratingLarge: {
    fontSize: 36,
    fontWeight: '400' as const,
    fontFamily: 'Newsreader_400Regular_Italic',
  } as TextStyle,
};

// Keep Fonts export for backwards compat
export const Fonts = Platform.select({
  ios: { sans: 'Manrope_400Regular', serif: 'Newsreader_400Regular', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'Manrope_400Regular', serif: 'Newsreader_400Regular', rounded: 'normal', mono: 'monospace' },
});
