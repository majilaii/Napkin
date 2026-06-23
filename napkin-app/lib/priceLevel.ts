/**
 * priceTierLabel — Google Places `price_level` (0–4) → "$"…"$$$$".
 *
 * Null / 0 (unknown or free) → "" so callers can omit the segment. The app uses
 * "$" (US convention, mirrors RestaurantHero/InfoTab) — the Heirloom design mocks
 * use "€" only because the prototype data is Amsterdam.
 */
export function priceTierLabel(level: number | null | undefined): string {
    if (level == null || level <= 0) return '';
    return '$'.repeat(Math.min(4, level));
}
