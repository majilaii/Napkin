/**
 * DiscoverPeopleSheet — the Map tab's "whose pins" picker (TICKET-137).
 *
 * Replaces the inline friend rail (founder: "very bugged"). EXCLUSIVE-include
 * semantics: an `Everyone` row at the top (checked when nothing else is) plus one
 * row per person you follow who has pins (avatar + name + check). Nothing checked
 * = everyone; checking a person shows ONLY their pins.
 *
 * DRAFT-APPLY (TICKET-147 review round): while the sheet is open, toggles mutate
 * a LOCAL draft set — the map's applied state is updated ONCE, on dismiss
 * (backdrop tap / Android back). This kills the multi-select bug's mechanism by
 * construction: per-tap application forced the always-mounted WishlistMapView to
 * reconcile its markers UNDER the open Modal, the prime suspect for the on-device
 * dropped taps ("only one person ticks at a time"). The count line narrates the
 * DRAFT live (`countFor`), so feedback stays instant; the Everyone row clears the
 * draft (stays open); exclusive-include semantics are unchanged from the map's
 * perspective.
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

/** Search is always visible (founder call 2026-07-09 — the old >8-row gate
 * hid it on small rosters and read as a missing feature). */
const SEARCH_THRESHOLD = 0;

interface Props {
    visible: boolean;
    /** Close the sheet. The sheet calls `onApply(draft)` first, then this. */
    onDismiss: () => void;
    palette: typeof Colors.light;
    people: DiscoverPerson[];
    /**
     * The APPLIED set (empty = everyone) — seeds the local draft each time the
     * sheet opens. NOT updated per tap (draft-apply).
     */
    checkedIds: ReadonlySet<string>;
    /** Apply the draft to the map — called exactly once, on dismiss. */
    onApply: (next: Set<string>) => void;
    /**
     * Quiet live count line (TICKET-147): `showing N places from everyone` /
     * `… from 2 people`. Called with the CURRENT DRAFT each render; the screen
     * computes it with the exact derivation the map renders (discoverItemsFor),
     * so the number matches the pins that will show on apply.
     */
    countFor?: (checkedIds: ReadonlySet<string>) => string;
    /**
     * TICKET-139: pinned "your table" rows above Everyone. One tap = exclusive-
     * include that table's member ids in the draft (overlap pins then hide per
     * 138 — correct, their VISITS show). Only for table members; ≤2 rows typical.
     */
    tableRows?: { tableId: string; name: string; memberIds: string[] }[];
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
    onApply,
    countFor,
    tableRows,
}: Props) {
    const insets = useSafeAreaInsets();

    // The DRAFT (draft-apply): seeded from the applied set on open, mutated
    // locally per tap, applied once on dismiss. The map never reconciles markers
    // while the Modal is up. While open, `checkedIds` stays stable (nothing
    // applies), so this effect only fires on visibility transitions.
    const [draft, setDraft] = useState<Set<string>>(() => new Set(checkedIds));
    // Client-side people search — shown only for long rosters (short lists don't
    // need it and the keyboard would just be in the way). Resets on close.
    const [query, setQuery] = useState('');
    useEffect(() => {
        if (visible) setDraft(new Set(checkedIds));
        else setQuery('');
    }, [visible, checkedIds]);

    const everyone = draft.size === 0;
    const applyAndDismiss = () => {
        onApply(draft);
        onDismiss();
    };
    const toggle = (id: string) =>
        setDraft((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const showSearch = people.length > SEARCH_THRESHOLD;
    const shownPeople = showSearch ? matchPeople(people, query) : people;

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={applyAndDismiss}>
            <Pressable style={styles.backdrop} onPress={applyAndDismiss}>
                <Pressable
                    style={[
                        styles.sheet,
                        { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + 16 },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />

                    <Text style={[styles.header, { color: palette.textMuted }]}>Show pins from</Text>

                    {countFor ? (
                        <Text style={[styles.count, { color: palette.textMuted }]}>{countFor(draft)}</Text>
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
                        {/* "your table" rows (TICKET-139) — one tap drafts only
                            that table's members. Rendered only for table members. */}
                        {(tableRows ?? []).map((r) => {
                            const selected = isTableSelected(draft, r.memberIds);
                            return (
                                <Pressable
                                    key={r.tableId}
                                    onPress={() => setDraft(new Set(r.memberIds))}
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

                        {/* Everyone — clears the DRAFT (stays open; dismissal applies). */}
                        <Pressable
                            onPress={() => setDraft(new Set())}
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
                            const checked = draft.has(p.id);
                            return (
                                <Pressable
                                    key={p.id}
                                    onPress={() => toggle(p.id)}
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
