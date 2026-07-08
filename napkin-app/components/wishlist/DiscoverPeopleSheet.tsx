/**
 * DiscoverPeopleSheet — the Map tab's "whose pins" picker (TICKET-137).
 *
 * Replaces the inline friend rail (founder: "very bugged"). EXCLUSIVE-include
 * semantics: an `Everyone` row at the top (checked when nothing else is) plus one
 * row per person you follow who has pins (avatar + name + check). Nothing checked
 * = everyone; checking a person shows ONLY their pins. The screen owns the
 * `checkedIds` set and the filtering (mapItems.ts helpers) — this just draws.
 *
 * Same RN-core Modal idiom as FilterTabsSheet: transparent + slide, tap-the-scrim
 * to dismiss, inner Pressable swallows taps, warm-dusk backdrop (no black scrim).
 * Copy economy: one Manrope header line; rows carry no prose.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius } from '@/constants/theme';
import { matchPeople, type DiscoverPerson } from './mapItems';

/** Above this many rows, the roster gets a client-side search field. */
const SEARCH_THRESHOLD = 8;

interface Props {
    visible: boolean;
    onDismiss: () => void;
    palette: typeof Colors.light;
    people: DiscoverPerson[];
    /** Empty = everyone; else the checked (exclusive-include) author ids. */
    checkedIds: ReadonlySet<string>;
    /**
     * Quiet live count line (TICKET-147): `showing N places from everyone` /
     * `… from 2 people`. Computed by the screen with the same filter helper the
     * map uses, so the number matches the pins on the map.
     */
    countLabel?: string;
    /** Toggle one person in/out of the checked set. */
    onToggle: (id: string) => void;
    /** Clear back to everyone (the `Everyone` row). */
    onEveryone: () => void;
    /**
     * TICKET-139: pinned "your table" rows above Everyone. One tap = exclusive-
     * include that table's member ids (overlap pins then hide per 138 — correct,
     * their VISITS show). Only for table members; ≤2 rows typical. Rendered only
     * when non-empty; the sheet stays presentational.
     */
    tableRows?: { tableId: string; name: string; memberIds: string[] }[];
    onSelectTable?: (memberIds: string[]) => void;
}

/** True when `checkedIds` is exactly this table's member set (same size + every
 * id present) — the "your table" row's selected state. */
function isTableSelected(checkedIds: ReadonlySet<string>, memberIds: string[]): boolean {
    if (memberIds.length === 0 || checkedIds.size !== memberIds.length) return false;
    return memberIds.every((id) => checkedIds.has(id));
}

export function DiscoverPeopleSheet({
    visible,
    onDismiss,
    palette,
    people,
    checkedIds,
    countLabel,
    onToggle,
    onEveryone,
    tableRows,
    onSelectTable,
}: Props) {
    const insets = useSafeAreaInsets();
    const everyone = checkedIds.size === 0;

    // Client-side people search — shown only for long rosters (short lists don't
    // need it and the keyboard would just be in the way). Resets on close.
    const [query, setQuery] = useState('');
    useEffect(() => {
        if (!visible) setQuery('');
    }, [visible]);
    const showSearch = people.length > SEARCH_THRESHOLD;
    const shownPeople = showSearch ? matchPeople(people, query) : people;

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <Pressable style={styles.backdrop} onPress={onDismiss}>
                <Pressable
                    style={[
                        styles.sheet,
                        { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + 16 },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />

                    <Text style={[styles.header, { color: palette.textMuted }]}>Show pins from</Text>

                    {countLabel ? (
                        <Text style={[styles.count, { color: palette.textMuted }]}>{countLabel}</Text>
                    ) : null}

                    {showSearch ? (
                        <View
                            style={[
                                styles.searchField,
                                { backgroundColor: palette.surfaceContainer, borderColor: palette.ruleWarmNib },
                            ]}
                        >
                            <Ionicons name="search" size={16} color={palette.textMuted} />
                            <TextInput
                                style={[styles.searchInput, { color: palette.text }]}
                                value={query}
                                onChangeText={setQuery}
                                placeholder="Search people"
                                placeholderTextColor={palette.textMuted}
                                autoCorrect={false}
                                autoCapitalize="none"
                                returnKeyType="search"
                                clearButtonMode="while-editing"
                            />
                        </View>
                    ) : null}

                    <ScrollView
                        style={styles.scroll}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* "your table" rows (TICKET-139) — one tap includes only
                            that table's members. Rendered only for table members. */}
                        {(tableRows ?? []).map((r) => {
                            const selected = isTableSelected(checkedIds, r.memberIds);
                            return (
                                <Pressable
                                    key={r.tableId}
                                    onPress={() => onSelectTable?.(r.memberIds)}
                                    style={styles.row}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected }}
                                    accessibilityLabel={r.name}
                                >
                                    <View style={[styles.avatar, { backgroundColor: palette.primaryMuted }]}>
                                        <Ionicons name="people-circle-outline" size={19} color={palette.primary} />
                                    </View>
                                    <Text
                                        style={[
                                            styles.tableName,
                                            {
                                                color: selected ? palette.primary : palette.text,
                                            },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {r.name}
                                    </Text>
                                    {selected ? (
                                        <Ionicons name="checkmark" size={18} color={palette.primary} />
                                    ) : null}
                                </Pressable>
                            );
                        })}

                        {/* Everyone — clears the exclusive set. */}
                        <Pressable
                            onPress={onEveryone}
                            style={styles.row}
                            accessibilityRole="button"
                            accessibilityState={{ selected: everyone }}
                            accessibilityLabel="everyone"
                        >
                            <View style={[styles.avatar, { backgroundColor: palette.primaryMuted }]}>
                                <Ionicons name="people" size={17} color={palette.primary} />
                            </View>
                            <Text
                                style={[
                                    styles.name,
                                    {
                                        color: everyone ? palette.primary : palette.text,
                                        fontFamily: everyone ? 'Manrope_700Bold' : 'Manrope_500Medium',
                                    },
                                ]}
                            >
                                Everyone
                            </Text>
                            {everyone ? (
                                <Ionicons name="checkmark" size={18} color={palette.primary} />
                            ) : null}
                        </Pressable>

                        {shownPeople.map((p) => {
                            const checked = checkedIds.has(p.id);
                            return (
                                <Pressable
                                    key={p.id}
                                    onPress={() => onToggle(p.id)}
                                    style={styles.row}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: checked }}
                                    accessibilityLabel={p.name}
                                >
                                    <View style={[styles.avatar, { backgroundColor: palette.primaryMuted }]}>
                                        {p.avatar ? (
                                            <ExpoImage
                                                source={{ uri: p.avatar }}
                                                style={styles.avatarImg}
                                                contentFit="cover"
                                            />
                                        ) : (
                                            <Text style={[styles.avatarInitial, { color: palette.primary }]}>
                                                {(p.name.trim()[0] ?? '?').toUpperCase()}
                                            </Text>
                                        )}
                                    </View>
                                    <Text
                                        style={[
                                            styles.name,
                                            {
                                                color: checked ? palette.primary : palette.text,
                                                fontFamily: checked ? 'Manrope_700Bold' : 'Manrope_500Medium',
                                            },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {p.name}
                                    </Text>
                                    {checked ? (
                                        <Ionicons name="checkmark" size={18} color={palette.primary} />
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        // Warm dusk, not a black scrim (matches FilterTabsSheet).
        backgroundColor: 'rgba(74,55,42,0.25)',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: 8,
    },
    grabber: {
        width: 40,
        height: 5,
        borderRadius: Radius.sm,
        alignSelf: 'center',
        opacity: 0.5,
        marginBottom: 4,
    },
    header: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        paddingHorizontal: 24,
        paddingTop: 10,
        paddingBottom: 2,
    },
    // Live count feedback — the sheet's only prose, and it's data.
    count: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        paddingHorizontal: 24,
        paddingBottom: 6,
    },
    searchField: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginHorizontal: 24,
        marginBottom: 4,
        paddingHorizontal: 12,
        height: 40,
        borderRadius: Radius.md,
        borderWidth: 1,
    },
    searchInput: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
        paddingVertical: 0,
    },
    scroll: {
        maxHeight: 400,
        marginTop: 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 24,
    },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    avatarImg: {
        width: '100%',
        height: '100%',
    },
    avatarInitial: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        includeFontPadding: false,
    },
    name: {
        flex: 1,
        fontSize: 16,
    },
    // Table names are brand voice → italic serif (not the Manrope person rows).
    tableName: {
        flex: 1,
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 17,
    },
});

export default DiscoverPeopleSheet;
