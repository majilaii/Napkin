/**
 * SearchEmptyState — the pre-query search page (TICKET-097).
 *
 * A quiet scrollable stack of the user's OWN material (doctrine: no public
 * trending/explore). Each section renders ONLY when it has data:
 *
 *   RECENT           persisted recent searches (+ quiet `clear`)
 *   PINNED NEAR YOU  nearest wishlist saves — absent without a prior
 *                    location grant (never prompts from this tab)
 *   YOUR LISTS       top 4 lists, typographic rows
 *
 * Brand-new user (all sections empty) → nothing but the search field.
 * No "see all" links — wishlist/lists have their own tabs.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import type { SearchResultRow as SearchResultRowType } from '@/hooks/search/useRestaurantSearch';
import type { MyList } from '@/hooks/lists/useMyLists';
import { PlacesCredit } from '@/components/ui/PlacesCredit';
import { RecentSearchesList } from './RecentSearchesList';
import { SearchResultRow } from './SearchResultRow';
import { TierHeader } from './TierHeader';
import { ListRow } from './ListRow';
import type { NearbyPinnedRow } from './emptyStateUtils';
import { deriveSearchPlacesCredits } from './searchPhotoPresentation';

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
    const [failedPhotoKeys, setFailedPhotoKeys] = useState<Set<string>>(() => new Set());
    const onPhotoError = useCallback((failureKey: string) => {
        setFailedPhotoKeys((current) => new Set(current).add(failureKey));
    }, []);
    const topLists = lists.slice(0, TOP_LISTS_COUNT);
    const nearbyPlacesCredit = deriveSearchPlacesCredits(
        nearbyPinned.map(({ row }) => row),
        failedPhotoKeys,
    );

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
                    {nearbyPlacesCredit.credits.length > 0 ? (
                        <View style={styles.placesCredit}>
                            <PlacesCredit
                                credits={nearbyPlacesCredit.credits}
                                photoCount={nearbyPlacesCredit.photoCount}
                                testID="search-nearby-places-credit"
                            />
                        </View>
                    ) : null}
                    {nearbyPinned.map(({ row, distanceLabel }) => (
                        <SearchResultRow
                            key={row.id ?? row.name}
                            item={row}
                            onPress={onPressRestaurant}
                            distanceLabel={distanceLabel}
                            failedPhotoKeys={failedPhotoKeys}
                            onPhotoError={onPhotoError}
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

const styles = StyleSheet.create({
    placesCredit: {
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.xs,
    },
});
