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

    // Text
    text: '#1c1c19',                 // on-surface (never pure black)
    textSecondary: '#5c614d',        // olive secondary
    textMuted: '#8a726c',            // warm taupe metadata

    // Brand
    primary: '#a03f28',              // terracotta
    primaryContainer: '#c0573e',     // lighter terracotta (for gradients)
    primaryMuted: 'rgba(160, 63, 40, 0.08)',
    secondary: '#5c614d',            // olive
    secondaryContainer: '#e0e5cc',   // olive cream
    tertiary: '#825516',             // amber
    tertiaryFixed: '#ffddb9',        // amber chip bg

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
    ruleInkSoft: 'rgba(138, 114, 108, 0.25)', // field underline resting (warm taupe)
    overlay: 'rgba(28, 28, 25, 0.4)',
    border: 'rgba(221, 192, 186, 0.15)',   // alias for compat
  },
  dark: {
    background: '#1a1816',
    surface: '#1a1816',
    surfaceContainer: '#252220',
    surfaceContainerLow: '#201e1c',
    surfaceContainerHigh: '#2a2724',
    card: '#2a2724',
    cardElevated: '#302c28',

    text: '#f3f0eb',
    textSecondary: '#c4c9b1',
    textMuted: '#a09888',

    primary: '#ffb4a3',
    primaryContainer: '#812914',
    primaryMuted: 'rgba(255, 180, 163, 0.12)',
    secondary: '#c4c9b1',
    secondaryContainer: '#444937',
    tertiary: '#f8bb73',
    tertiaryFixed: '#663e00',

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
    ruleInkSoft: 'rgba(160, 152, 136, 0.3)', // field underline resting (dark parity)
    overlay: 'rgba(0, 0, 0, 0.6)',
    border: 'rgba(86, 66, 61, 0.3)',
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
  sm: 4,     // scrapbook clips
  md: 12,
  lg: 16,
  xl: 24,    // cards
  xxl: 32,   // hero cards
  full: 9999,
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
