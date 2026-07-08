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
 * null/blank, matching the app's existing no-image italic-serif letter grammar.
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

// ── 3. Lore registry — "which words" (stub this ticket; TICKET-145 fills) ────
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

export function loreFor(_stats: unknown): { epithet: string | null } {
    return { epithet: null }; // TICKET-145 replaces with epithetFor()
}
