/**
 * filterTabsUtils — pure tab-visibility logic for FilterTabsSheet (TICKET-124).
 *
 * Extracted so the "which tabs show, and which is the default" rule can be unit
 * tested without pulling in React Native (same pattern as mapPinsUtils /
 * listsSectionUtils). No I/O, no React, no native.
 *
 * The tabbed filter sheet re-presents the EXISTING wishlist filter state as four
 * tabs in a fixed order — Cuisine · Price · Area · Sort:
 *   • Cuisine is always present.
 *   • Price is always present.
 *   • Area (= city) is hidden when the saved set spans <2 cities (hideArea).
 *   • Sort is hidden in map mode — position is the signal on a map (hideSort).
 * "Category" and "Reactions" tabs are deliberately NOT built (no backing field /
 * n/a to Napkin — see the ticket's Decisions locked).
 */

export type FilterTabKey = 'cuisine' | 'price' | 'area' | 'sort';

export interface FilterTabsVisibility {
    /** Map mode: Sort is meaningless (position is the signal) → hide the tab. */
    hideSort?: boolean;
    /** <2 cities in the saved set → the Area (city) tab has nothing to offer. */
    hideArea?: boolean;
}

/**
 * The ordered list of visible tabs given the hide flags. Order is fixed
 * (Cuisine · Price · Area · Sort); hidden tabs drop out in place.
 */
export function visibleFilterTabs(v: FilterTabsVisibility): FilterTabKey[] {
    const tabs: FilterTabKey[] = ['cuisine', 'price'];
    if (!v.hideArea) tabs.push('area');
    if (!v.hideSort) tabs.push('sort');
    return tabs;
}

/** The default active tab = the first visible tab (Cuisine, unless all removed). */
export function defaultFilterTab(v: FilterTabsVisibility): FilterTabKey {
    return visibleFilterTabs(v)[0] ?? 'cuisine';
}

/**
 * Clamp a possibly-stale active tab to a visible one. When the current tab has
 * been hidden (e.g. you were on Sort, then entered map mode), fall back to the
 * default so the sheet never renders an empty/hidden tab.
 */
export function resolveActiveTab(active: FilterTabKey, v: FilterTabsVisibility): FilterTabKey {
    const visible = visibleFilterTabs(v);
    return visible.includes(active) ? active : (visible[0] ?? 'cuisine');
}

/** Human label per tab (Title case; the sheet renders it uppercase via style). */
export const FILTER_TAB_LABELS: Record<FilterTabKey, string> = {
    cuisine: 'Cuisine',
    price: 'Price',
    area: 'Area',
    sort: 'Sort',
};
