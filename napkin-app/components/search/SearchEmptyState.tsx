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
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, IconSize, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
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
    showUseMyLocation: boolean;
    onUseMyLocation: () => void;
    onPressRestaurant: (item: SearchResultRowType) => void;
    lists: MyList[];
    onPressList: (list: MyList) => void;
}

export function SearchEmptyState({
    recentQueries,
    onSelectRecent,
    onClearRecents,
    nearbyPinned,
    showUseMyLocation,
    onUseMyLocation,
    onPressRestaurant,
    lists,
    onPressList,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
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

            {showUseMyLocation && (
                <Pressable
                    onPress={onUseMyLocation}
                    style={({ pressed }) => [styles.locationRow, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel="use my location"
                >
                    <Ionicons
                        name="location-outline"
                        size={IconSize.lg}
                        color={palette.textMuted}
                    />
                    <Text style={[Type.body, { color: palette.textMuted }]}>use my location</Text>
                </Pressable>
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

const styles = StyleSheet.create({
    locationRow: {
        minHeight: 44,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    pressed: { opacity: 0.6 },
});
