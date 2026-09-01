/**
 * SearchEmptyState — the pre-query search page (TICKET-097).
 *
 * A quiet scrollable stack of the user's OWN material (doctrine: no public
 * trending/explore). Each section renders ONLY when it has data:
 *
 *   RECENT           persisted recent searches (+ quiet `clear`)
 *   PINNED NEAR YOU  nearest wishlist saves — absent without a granted
 *                    current-location choice
 *   YOUR LISTS       top 4 lists, typographic rows
 *
 * Brand-new user (all sections empty) → nothing but the search field.
 * No "see all" links — wishlist/lists have their own tabs.
 */
import React from 'react';
import { View } from 'react-native';
import type { SearchResultRow as SearchResultRowType } from '@/hooks/search/useRestaurantSearch';
import type { MyList } from '@/hooks/lists/useMyLists';
import { RecentSearchesList } from './RecentSearchesList';
import { SearchResultRow } from './SearchResultRow';
import { TierHeader } from './TierHeader';
import { ListRow } from './ListRow';
import type { NearbyPinnedRow } from './emptyStateUtils';

const TOP_LISTS_COUNT = 4;

interface Props {
    recentQueries: readonly string[];
    onSelectRecent: (query: string) => void;
    onClearRecents: () => void;
    nearbyPinned: NearbyPinnedRow[];
    onPressRestaurant: (item: SearchResultRowType) => void;
    lists: MyList[];
    onPressList: (list: MyList) => void;
}

export function SearchEmptyState({
    recentQueries,
    onSelectRecent,
    onClearRecents,
    nearbyPinned,
    onPressRestaurant,
    lists,
    onPressList,
}: Props) {
    const topLists = lists.slice(0, TOP_LISTS_COUNT);
    return (
        <View>
            {recentQueries.length > 0 && (
                <RecentSearchesList
                    queries={recentQueries}
                    onSelect={onSelectRecent}
                    onClear={onClearRecents}
                />
            )}

            {nearbyPinned.length > 0 && (
                <View>
                    <TierHeader label="Pinned near you" />
                    {nearbyPinned.map(({ row, distanceLabel }) => (
                        <SearchResultRow
                            key={row.id ?? row.name}
                            item={row}
                            onPress={onPressRestaurant}
                            distanceLabel={distanceLabel}
                        />
                    ))}
                </View>
            )}

            {topLists.length > 0 && (
                <View>
                    <TierHeader label="Your lists" />
                    {topLists.map((list) => (
                        <ListRow key={list.id} list={list} onPress={onPressList} />
                    ))}
                </View>
            )}
        </View>
    );
}
