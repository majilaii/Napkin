import React from 'react';
import {
    ActivityIndicator,
    Image,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { RecentSearchesList, TierHeader } from '@/components/search';
import type { SnapSheetContentContext } from '@/components/sheets/SnapSheet';
import { Colors, IconSize, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { MyList } from '@/hooks/lists/useMyLists';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';
import { tintFor } from '@/lib/engraving';
import { PlacesRow } from './PlacesRow';
import type { DecoratedPlacesRow, PlacesDisplayRow } from './placesPresentation';

interface Props {
    recentQueries: readonly string[];
    nearbyRows: readonly DecoratedPlacesRow[];
    myLists: readonly MyList[];
    following: readonly UserSearchResult[];
    loading: boolean;
    onSelectRecent: (query: string) => void;
    onClearRecent: () => void;
    onOpenRestaurant: (row: PlacesDisplayRow) => void;
    onOpenList: (list: { id: string }) => void;
    onOpenPerson: (userId: string) => void;
    bottomPadding: number;
    scrollEnabled?: boolean;
    onScroll?: SnapSheetContentContext['onScroll'];
}

function firstName(name: string): string {
    return name.trim().split(/\s+/)[0] || name;
}

function initials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((part) => part[0] ?? '')
        .join('')
        .toUpperCase() || '·';
}

export function PlacesSearchSections({
    recentQueries,
    nearbyRows,
    myLists,
    following,
    loading,
    onSelectRecent,
    onClearRecent,
    onOpenRestaurant,
    onOpenList,
    onOpenPerson,
    bottomPadding,
    scrollEnabled = true,
    onScroll,
}: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const hasContent = recentQueries.length > 0
        || nearbyRows.length > 0
        || myLists.length > 0
        || following.length > 0;

    return (
        <Animated.FlatList
            testID="places-search-sections"
            data={[] as string[]}
            keyExtractor={(item) => item}
            renderItem={() => null}
            scrollEnabled={scrollEnabled}
            onScroll={onScroll}
            scrollEventThrottle={16}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.content, { paddingBottom: bottomPadding }]}
            ListHeaderComponent={(
                <>
                    {recentQueries.length > 0 ? (
                        <RecentSearchesList
                            queries={recentQueries}
                            onSelect={onSelectRecent}
                            onClear={onClearRecent}
                            accentHeader
                        />
                    ) : null}
                    {nearbyRows.length > 0 ? (
                        <View>
                            <TierHeader label="Near you" accent />
                            {nearbyRows.map((item) => (
                                <PlacesRow
                                    key={item.row.id}
                                    item={item}
                                    onPress={onOpenRestaurant}
                                    showThumbnail
                                />
                            ))}
                        </View>
                    ) : null}
                    {myLists.length > 0 ? (
                        <View>
                            <TierHeader label="Your lists" accent />
                            {myLists.map((list) => (
                                <Pressable
                                    key={list.id}
                                    onPress={() => onOpenList(list)}
                                    style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                                    accessibilityRole="button"
                                    accessibilityLabel={`open list ${list.title}`}
                                >
                                    <View
                                        style={[
                                            styles.listPlate,
                                            { backgroundColor: tintFor(list.id, palette) },
                                        ]}
                                    >
                                        {list.emoji ? (
                                            <Text style={Type.headlineMedium}>{list.emoji}</Text>
                                        ) : (
                                            <Ionicons
                                                name="albums-outline"
                                                size={IconSize.md}
                                                color={palette.textSecondary}
                                            />
                                        )}
                                    </View>
                                    <View style={styles.listCopy}>
                                        <Text style={[Type.feedNoteRestaurant, { color: palette.text }]}>
                                            {list.title}
                                        </Text>
                                        <Text style={[Type.metadata, { color: palette.textMuted }]}>
                                            {`${list.entry_count} ${list.entry_count === 1 ? 'spot' : 'spots'}`}
                                        </Text>
                                    </View>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                    {following.length > 0 ? (
                        <View>
                            <TierHeader label="People you follow" accent />
                            <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.peopleRail}
                            >
                                {following.map((person) => (
                                    <Pressable
                                        key={person.user_id}
                                        onPress={() => onOpenPerson(person.user_id)}
                                        style={({ pressed }) => [styles.person, pressed && styles.pressed]}
                                        accessibilityRole="button"
                                        accessibilityLabel={`open ${person.display_name}`}
                                    >
                                        <View
                                            style={[
                                                styles.avatar,
                                                {
                                                    backgroundColor: tintFor(person.user_id, palette),
                                                    borderColor: palette.imageOutline,
                                                },
                                            ]}
                                        >
                                            {person.avatar_url ? (
                                                <Image
                                                    source={{ uri: person.avatar_url }}
                                                    style={styles.avatarImage}
                                                    resizeMode="cover"
                                                />
                                            ) : (
                                                <Text style={[Type.feedNoteRestaurant, { color: palette.textSecondary }]}>
                                                    {initials(person.display_name)}
                                                </Text>
                                            )}
                                        </View>
                                        <Text
                                            style={[Type.metadata, styles.personName, { color: palette.text }]}
                                            numberOfLines={1}
                                        >
                                            {firstName(person.display_name)}
                                        </Text>
                                    </Pressable>
                                ))}
                            </ScrollView>
                        </View>
                    ) : null}
                    {!hasContent ? (
                        <View style={styles.empty}>
                            {loading ? (
                                <ActivityIndicator color={palette.primary} />
                            ) : (
                                <Text style={[Type.metadata, { color: palette.textMuted }]}>
                                    search a place, list or person
                                </Text>
                            )}
                        </View>
                    ) : null}
                </>
            )}
        />
    );
}

const styles = StyleSheet.create({
    content: {
        flexGrow: 1,
    },
    pressed: {
        opacity: 0.64,
    },
    listRow: {
        minHeight: Spacing.hitTarget + Spacing.md,
        paddingHorizontal: Spacing.pageGutter,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm + Spacing.xs,
    },
    listPlate: {
        width: Spacing.hitTarget,
        height: Spacing.hitTarget,
        borderRadius: Radius.memory,
        alignItems: 'center',
        justifyContent: 'center',
    },
    listCopy: {
        flex: 1,
        gap: Spacing.xs / 2,
    },
    peopleRail: {
        paddingHorizontal: Spacing.pageGutter,
        paddingTop: Spacing.xs,
        paddingBottom: Spacing.lg,
        gap: Spacing.sm + Spacing.xs + Spacing.xs / 2,
    },
    person: {
        width: Spacing.xxl + Spacing.md,
        alignItems: 'center',
        gap: Spacing.sm - Spacing.xs / 2,
    },
    avatar: {
        width: Spacing.xxl + Spacing.sm,
        height: Spacing.xxl + Spacing.sm,
        borderRadius: Radius.full,
        borderWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
    },
    avatarImage: {
        width: '100%',
        height: '100%',
    },
    personName: {
        maxWidth: '100%',
    },
    empty: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl + Spacing.xs,
        paddingVertical: Spacing.xxl - Spacing.sm + Spacing.xs / 2,
    },
});
