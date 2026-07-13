/**
 * A small, deterministic set of shared Taste emblems. The emblem is deliberately
 * derived from observable journal behaviour rather than inferred personality:
 * geographic spread (concentrated / roaming) and repeat pattern (returning /
 * discovering).
 */
export type TasteEmblemKey = 'compass' | 'atlas' | 'lantern' | 'hearth';

export type TasteEmblemInput = {
    totalMeals: number;
    totalPlaces: number;
    cityCount: number;
    countryCount: number;
};

export type TasteEmblem = {
    key: TasteEmblemKey;
    title: string;
    facets: readonly [string, string];
    description: string;
};

export const TASTE_EMBLEM_MEAL_FLOOR = 10;

const EMBLEMS: Record<TasteEmblemKey, TasteEmblem> = {
    compass: {
        key: 'compass',
        title: 'The Compass',
        facets: ['Roaming', 'Discovering'],
        description: 'A wide-ranging journal, usually choosing somewhere new.',
    },
    atlas: {
        key: 'atlas',
        title: 'The Atlas',
        facets: ['Roaming', 'Returning'],
        description: 'A wide-ranging journal, with a few tables worth returning to.',
    },
    lantern: {
        key: 'lantern',
        title: 'The Lantern',
        facets: ['Concentrated', 'Discovering'],
        description: 'A tightly clustered journal, usually choosing somewhere new.',
    },
    hearth: {
        key: 'hearth',
        title: 'The Hearth',
        facets: ['Concentrated', 'Returning'],
        description: 'A tightly clustered journal, with tables worth returning to.',
    },
};

/**
 * Cast a Taste emblem once the journal has enough evidence to support one.
 *
 * Roaming: at least three cities or two countries.
 * Returning: at least 1.5 logged meals per distinct place.
 * The inclusive boundaries make the result stable instead of flickering around
 * tiny floating-point differences.
 */
export function tasteEmblemFor(input: TasteEmblemInput): TasteEmblem | null {
    const hasGeography = input.cityCount > 0 || input.countryCount > 0;
    if (input.totalMeals < TASTE_EMBLEM_MEAL_FLOOR || input.totalPlaces <= 0 || !hasGeography) return null;

    const roaming = input.cityCount >= 3 || input.countryCount >= 2;
    const returning = input.totalMeals / input.totalPlaces >= 1.5;

    if (roaming && !returning) return EMBLEMS.compass;
    if (roaming && returning) return EMBLEMS.atlas;
    if (!roaming && !returning) return EMBLEMS.lantern;
    return EMBLEMS.hearth;
}
