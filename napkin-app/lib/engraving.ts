/**
 * engraving.ts — TICKET-146. The single identity system: one glyph + color +
 * word grammar that every surface (Top-4 marquee plates, map bubble pins,
 * trending glyph chips, and later the crest) draws from. Symbols and colors are
 * decided by RULES, never per-item by a human.
 *
 * Three registries, all deterministic:
 *   1. Mark  — which symbol (emoji → cuisine glyph → monogram fallback)
 *   2. Tint  — which color (6 warm tonal creams, seeded by restaurant id)
 *   3. Lore  — which words (noun bank per glyph bucket; epithet — TICKET-145)
 *
 * Kept runtime-dependency-free (no @expo/vector-icons, no native modules) so it
 * stays jest-safe next to lib/cuisineGlyph.ts. The palette type is imported with
 * `import type`, so it is elided at runtime. Consumers render the discriminated
 * `Mark` union themselves — this file never returns a React node.
 *
 * NOTE (deviation from the ticket's `tintFor(cuisine)` shorthand): tint is seeded
 * on the caller-supplied stable id (restaurant_id), not the cuisine string, so a
 * 4-plate row has visible variety while "Dorian is olive-cream forever" stays
 * true. Signature is `tintFor(seed, palette)`.
 */
import { cuisineGlyph, tintIndex, type CuisineGlyph } from './cuisineGlyph';
import type { Colors } from '@/constants/theme';

// Re-export the low-level glyph rules so consumers import identity from ONE place
// (absorb-by-re-export — cuisineGlyph.ts stays the dependency-free glyph leaf).
export { cuisineGlyph, tintIndex, type CuisineGlyph };

type Palette = typeof Colors.light;

// ── 1. Mark registry — "which symbol" ───────────────────────────────────────
export type Mark =
    | { kind: 'emoji'; emoji: string }
    | { kind: 'glyph'; glyph: CuisineGlyph }
    | { kind: 'monogram'; letter: string };

export interface MarkInput {
    name: string;
    cuisine?: string | null;
    /** TICKET-108 emoji-wins: owning-list emoji, if any. */
    listEmoji?: string | null;
}

/**
 * Priority chain, identical on every surface:
 *   emoji (list) → cuisine glyph (fires whenever cuisine present) → monogram.
 * The monogram is the true no-data fallback — it fires ONLY when cuisine is
 * null/blank, matching the app's upright editorial monogram grammar.
 */
export function markFor(item: MarkInput): Mark {
    const emoji = item.listEmoji?.trim();
    if (emoji) return { kind: 'emoji', emoji };
    const cuisine = item.cuisine?.trim();
    if (cuisine) return { kind: 'glyph', glyph: cuisineGlyph(cuisine) };
    const letter = (item.name?.trim()?.[0] ?? '·').toUpperCase();
    return { kind: 'monogram', letter };
}

// ── 2. Tint registry — "which color" (6 warm tonal creams) ──────────────────
/** 6-way hash (same idiom as tintIndex, wider range). Deterministic per seed. */
export function tintIndex6(seed: string): 0 | 1 | 2 | 3 | 4 | 5 {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return (h % 6) as 0 | 1 | 2 | 3 | 4 | 5;
}

/** Plate ground for a restaurant. `seed` = restaurant_id (recognition anchor). */
export function tintFor(seed: string, palette: Palette): string {
    const tints = [
        palette.plateAmber, palette.plateOlive, palette.plateRose,
        palette.plateGrey, palette.plateSlate, palette.plateSand,
    ] as const;
    return tints[tintIndex6(seed)];
}

// ── 3. Lore registry — "which words" (the epithet, TICKET-145) ──────────────
/** Noun bank keyed by glyph bucket — adding a RULES needle inherits a noun. */
export const LORE_NOUN_BY_GLYPH: Record<CuisineGlyph, string> = {
    'pizza-outline': 'trattoria',
    'fish-outline': 'raw bar',
    'cafe-outline': 'corner table',
    'wine-outline': 'wine room',
    'ice-cream-outline': 'sweet tooth',
    'fast-food-outline': 'counter',
    'beer-outline': 'taproom',
    'flame-outline': 'smokehouse',
    'restaurant-outline': 'small rooms',
};

/**
 * The Taste Relic, direction A — the epithet. A two-part upright serif title
 * generated from already-fetched profile data, set like a book dedication.
 * Deterministic (same input → same title, forever — it reads as identity, not a
 * slot machine; it drifts only because your eating changed). Never gamified.
 *
 * Data FLOOR = 10 meals: below it, `epithetFor` returns null and the TASTE band
 * renders exactly as before (thin data must never produce a confident title).
 */
export interface EpithetInput {
    totalMeals: number; // Σ visit_count
    totalPlaces: number; // spots.length
    dominantCuisine: string | null; // topCuisines[0] (already lower-cased)
    cityCount: number;
    countryCount: number;
    priceMode: number | null; // 1..4 modal price_level, or null
}

const EPITHET_FLOOR_MEALS = 10;

// Adjective band from behaviour (repeat ratio = meals / places).
//   ratio >= 1.8                    → "devoted" (goes back again and again)
//   ratio <= 1.15 AND cityCount>=3  → "roving"  (spread wide, rarely repeats)
//   else                            → "steady"
function adjectiveFor(input: EpithetInput): string {
    const ratio = input.totalPlaces > 0 ? input.totalMeals / input.totalPlaces : 1;
    if (ratio >= 1.8) return 'devoted';
    if (ratio <= 1.15 && input.cityCount >= 3) return 'roving';
    return 'steady';
}

// Noun from dominant cuisine, via the glyph bucket → LORE_NOUN_BY_GLYPH.
// Falls back to 'small rooms' (restaurant-outline bucket) when cuisine is null.
function nounFor(cuisine: string | null): string {
    return LORE_NOUN_BY_GLYPH[cuisineGlyph(cuisine)];
}

// Qualifier from price/city texture (one phrase, or ''). First match wins.
function qualifierFor(input: EpithetInput): string {
    if (input.countryCount >= 3) return 'across borders';
    if (input.priceMode === 4) return 'of the grand rooms';
    if (input.priceMode === 1) return 'of cheap eats';
    if (input.cityCount >= 5) return 'of many cities';
    return '';
}

/**
 * Two-part upright-serif epithet, book-dedication voice. Lowercase (Heirloom),
 * no title-case. Returns null below the meal floor (band stays as-is).
 * e.g. "a devoted regular of the smokehouse" ·
 *      "a roving regular of the raw bar, across borders".
 */
export function epithetFor(input: EpithetInput): string | null {
    if (input.totalMeals < EPITHET_FLOOR_MEALS) return null;
    const adj = adjectiveFor(input);
    const noun = nounFor(input.dominantCuisine);
    const qual = qualifierFor(input);
    const core = `a ${adj} regular of the ${noun}`;
    return qual ? `${core}, ${qual}` : core;
}
