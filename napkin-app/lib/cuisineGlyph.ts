/**
 * cuisineGlyph — TICKET-130. Cuisine string → Ionicons OUTLINE glyph name for
 * the For You "Gazette mix" engraved chips (GlyphChip). Pure + dependency-free
 * so it stays jest-safe (no @expo/vector-icons import — the literal union below
 * is checked against the real Ionicons name union at the GlyphChip call site).
 *
 * Case-insensitive substring match, first rule wins. Guard rules run before
 * collision-prone needles ('breakfast' contains 'fast'; 'barbecue' contains
 * 'bar'), and the promiscuous 'bar' needle runs last. Unknown/absent cuisine →
 * 'restaurant-outline'. NO react-native-svg — Ionicons only (not installed).
 */

export type CuisineGlyph =
    | 'pizza-outline'
    | 'fish-outline'
    | 'cafe-outline'
    | 'wine-outline'
    | 'ice-cream-outline'
    | 'fast-food-outline'
    | 'beer-outline'
    | 'flame-outline'
    | 'restaurant-outline';

/** Ordered: earlier rules shadow later substring collisions. */
const RULES: readonly (readonly [readonly string[], CuisineGlyph])[] = [
    [['pizza'], 'pizza-outline'],
    [['seafood', 'fish', 'sushi'], 'fish-outline'],
    // Guard: 'breakfast' would otherwise hit the 'fast' needle below.
    [['breakfast', 'brunch'], 'cafe-outline'],
    [['cafe', 'coffee', 'bakery'], 'cafe-outline'],
    [['dessert', 'ice cream', 'gelato'], 'ice-cream-outline'],
    [['burger', 'american', 'fast'], 'fast-food-outline'],
    [['beer', 'pub'], 'beer-outline'],
    // Guard: 'barbecue' would otherwise hit the 'bar' needle below.
    [['barbecue', 'bbq'], 'flame-outline'],
    [['bar', 'wine', 'cocktail'], 'wine-outline'],
];

export function cuisineGlyph(cuisine: string | null | undefined): CuisineGlyph {
    if (!cuisine) return 'restaurant-outline';
    const c = cuisine.toLowerCase();
    for (const [needles, glyph] of RULES) {
        if (needles.some((needle) => c.includes(needle))) return glyph;
    }
    return 'restaurant-outline';
}

/**
 * tintIndex — deterministic 0..2 pick for the chip/poster background tint,
 * seeded from an id so a given restaurant/list keeps its tint across renders
 * and screens (same idiom as Avatar's initials tint). Components map the index
 * onto [surfaceJournal, oliveCream, tertiaryFixed] palette tokens.
 */
export function tintIndex(seed: string): 0 | 1 | 2 {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return (h % 3) as 0 | 1 | 2;
}
