/**
 * derivePlaceTags — Google place types → human tag chips for the restaurant
 * page ("fine dining", "small plates", "wine bar").
 *
 * Honest data only: these are Places taxonomy types, not vibes. Structural
 * junk types are dropped, known types get hand-set labels, unknown *_restaurant
 * types fall back to a cleaned form ("lebanese_restaurant" → "lebanese").
 * The cuisine already shown in the kicker is excluded. Capped at 4.
 */

const IGNORE = new Set([
    'restaurant',
    'food',
    'point_of_interest',
    'establishment',
    'store',
    'meal_takeaway',
    'meal_delivery',
    'lodging',
    'hotel',
    'tourist_attraction',
    'event_venue',
    'grocery_store',
    'supermarket',
]);

const LABELS: Record<string, string> = {
    fine_dining_restaurant: 'fine dining',
    tapas_restaurant: 'small plates',
    tapas_bar: 'small plates',
    wine_bar: 'wine bar',
    bar: 'bar',
    pub: 'pub',
    cafe: 'café',
    coffee_shop: 'coffee',
    bakery: 'bakery',
    brunch_restaurant: 'brunch',
    breakfast_restaurant: 'breakfast',
    dessert_shop: 'dessert',
    dessert_restaurant: 'dessert',
    ice_cream_shop: 'ice cream',
    steak_house: 'steakhouse',
    sushi_restaurant: 'sushi',
    ramen_restaurant: 'ramen',
    seafood_restaurant: 'seafood',
    barbecue_restaurant: 'barbecue',
    pizza_restaurant: 'pizza',
    hamburger_restaurant: 'burgers',
    sandwich_shop: 'sandwiches',
    vegetarian_restaurant: 'vegetarian',
    vegan_restaurant: 'vegan',
    cocktail_bar: 'cocktails',
    juice_shop: 'juice',
    tea_house: 'tea house',
    buffet_restaurant: 'buffet',
    food_court: 'food court',
    bistro: 'bistro',
    brasserie: 'brasserie',
    izakaya_restaurant: 'izakaya',
    dim_sum_restaurant: 'dim sum',
    hot_pot_restaurant: 'hot pot',
    noodle_shop: 'noodles',
};

export function derivePlaceTags(
    types: string[] | null | undefined,
    cuisine: string | null,
): string[] {
    if (!types || types.length === 0) return [];
    const cuisineLc = cuisine?.trim().toLowerCase() ?? null;
    const out: string[] = [];
    for (const t of types) {
        if (IGNORE.has(t)) continue;
        let label = LABELS[t];
        if (!label) {
            // "lebanese_restaurant" → "lebanese"; skip anything that doesn't clean up.
            if (t.endsWith('_restaurant')) {
                label = t.slice(0, -'_restaurant'.length).replace(/_/g, ' ');
            } else {
                continue;
            }
        }
        if (cuisineLc && label.toLowerCase() === cuisineLc) continue;
        if (!out.includes(label)) out.push(label);
        if (out.length >= 4) break;
    }
    return out;
}
