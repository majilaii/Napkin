/**
 * TICKET-106 — pure tab-ordering for SearchModeTabs.
 * Order is places · lists · people. People is conditionally dropped when
 * people-search is curtained (FRIEND_TEST.hidePeopleSearch), but Lists ALWAYS
 * survives — it is decoupled from the people-search curtain.
 */
export type SearchMode = 'places' | 'people' | 'lists';

export interface SearchTab {
    mode: SearchMode;
    label: string;
}

const ALL_TABS: SearchTab[] = [
    { mode: 'places', label: 'places' },
    { mode: 'lists', label: 'lists' },
    { mode: 'people', label: 'people' },
];

export function visibleSearchTabs(hidePeople: boolean): SearchTab[] {
    return hidePeople ? ALL_TABS.filter((t) => t.mode !== 'people') : ALL_TABS;
}
