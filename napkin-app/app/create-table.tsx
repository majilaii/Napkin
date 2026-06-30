/**
 * Create Table — the "New table" editorial-masthead screen.
 * Implements the Claude Design "New Table" canvas, direction 2A
 * ("Editorial masthead", taken forward — handoff 2026-06-30).
 *
 * One calm column: kicker → big serif title → italic one-liner → hairline →
 * Name (underline field + helper) → Invite the table (you·founder chip, search
 * row, invite-by-link) → a confident terracotta "Create table" CTA.
 *
 * Backend (unchanged): useCreateTable creates the table (creator auto-added as
 * admin), then each invited mutual-follow is added via useAddMember. On success
 * we land on the new table's founded masthead via /(tabs)/tables?selected=<id>.
 *
 * Layout is keyboard-STABLE: one top-anchored ScrollView with iOS keyboard
 * insets (no KeyboardAvoidingView reflow) and constant border widths — focus
 * changes colour only, never width, so tapping a field never shifts layout.
 *
 * "Invite by link" is faint Phase-2 — no link backend yet, so Copy is inert.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    StyleSheet,
    Animated,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useCreateTable } from '@/hooks/tables/useCreateTable';
import { useAddMember } from '@/hooks/tables/useAddMember';
import { useUserSearch, type UserSearchResult } from '@/hooks/users/useUserSearch';
import { Avatar } from '@/components/feed/Avatar';

type Palette = typeof Colors.light;

// Horizontal gutter — matches the 28px canvas margin (not on the 4-pt token scale).
const GUTTER = 28;

interface PickedMember {
    user_id: string;
    display_name: string;
    avatar_url: string | null;
}

export default function CreateTableScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const [name, setName] = useState('');
    const [nameFocused, setNameFocused] = useState(false);
    const [picked, setPicked] = useState<PickedMember[]>([]);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [searchFocused, setSearchFocused] = useState(false);
    const [creating, setCreating] = useState(false);

    const createTable = useCreateTable(user?.id);
    const addMember = useAddMember(user?.id);

    // Debounce the search query (250ms).
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query.trim()), 250);
        return () => clearTimeout(t);
    }, [query]);

    const { data: results, isFetching } = useUserSearch(
        debouncedQuery,
        debouncedQuery.length > 0,
        { mutualOnly: true },
    );

    const nameTrimmed = name.trim();
    const canCreate = nameTrimmed.length > 0 && !creating;
    const pickedIds = useMemo(() => new Set(picked.map((p) => p.user_id)), [picked]);
    const searching = debouncedQuery.length > 0;
    const nameActive = nameFocused || nameTrimmed.length > 0;

    const togglePick = useCallback((row: UserSearchResult) => {
        setPicked((prev) => {
            if (prev.some((p) => p.user_id === row.user_id)) {
                return prev.filter((p) => p.user_id !== row.user_id);
            }
            return [
                ...prev,
                { user_id: row.user_id, display_name: row.display_name, avatar_url: row.avatar_url },
            ];
        });
    }, []);

    const removePick = useCallback((userId: string) => {
        setPicked((prev) => prev.filter((p) => p.user_id !== userId));
    }, []);

    const handleCreate = useCallback(async () => {
        if (!canCreate) return;
        setCreating(true);
        try {
            const table = await createTable.mutateAsync({ name: nameTrimmed });

            // Best-effort: add each invited mutual-follow. A single failure
            // (e.g. follow changed since search) must not block the table.
            if (picked.length > 0) {
                const outcomes = await Promise.allSettled(
                    picked.map((p) =>
                        addMember.mutateAsync({ tableId: table.id, targetUserId: p.user_id }),
                    ),
                );
                const failed = outcomes.filter((o) => o.status === 'rejected').length;
                if (failed > 0) {
                    Alert.alert(
                        'Table created',
                        failed === 1
                            ? "One person couldn't be added — you can invite them again from the table."
                            : `${failed} people couldn't be added — you can invite them again from the table.`,
                    );
                }
            }

            router.replace({ pathname: '/(tabs)/tables', params: { selected: table.id } });
        } catch {
            setCreating(false);
            Alert.alert('Could not create table', 'Please try again in a moment.');
        }
    }, [canCreate, createTable, nameTrimmed, picked, addMember, router]);

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: 8 }]}>
            {/* Drag handle */}
            <View style={styles.handleWrap}>
                <View style={[styles.handle, { backgroundColor: palette.ruleInkSoft }]} />
            </View>

            <ScrollView
                style={styles.flex}
                contentContainerStyle={styles.scrollContent}
                keyboardShouldPersistTaps="handled"
                automaticallyAdjustKeyboardInsets
                showsVerticalScrollIndicator={false}
            >
                {/* Cancel */}
                <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
                    <Text style={[styles.cancel, { color: palette.textMuted }]}>Cancel</Text>
                </Pressable>

                {/* Name */}
                <View style={styles.nameSection}>
                    <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>Name</Text>
                    <View
                        style={[
                            styles.nameUnderline,
                            { borderBottomColor: nameActive ? palette.primary : palette.ruleInkSoft },
                        ]}
                    >
                        <TextInput
                            value={name}
                            onChangeText={setName}
                            onFocus={() => setNameFocused(true)}
                            onBlur={() => setNameFocused(false)}
                            placeholder="Sunday Roast Club"
                            placeholderTextColor={palette.textMuted}
                            style={[styles.nameInput, { color: palette.text }]}
                            selectionColor={palette.primary}
                            returnKeyType="done"
                            maxLength={60}
                        />
                    </View>
                </View>

                {/* Invite the table */}
                <View style={styles.inviteSection}>
                    <View style={styles.inviteHeaderRow}>
                        <Text style={[styles.fieldLabel, { color: palette.textSecondary }]}>Invite the table</Text>
                        <Text style={[styles.optional, { color: palette.textMuted }]}>· optional</Text>
                    </View>

                    {/* you · founder + any added members */}
                    <View style={styles.chipsRow}>
                        <View style={[styles.chip, { backgroundColor: palette.secondaryContainer }]}>
                            <Avatar name="You" url={null} size={28} palette={palette} />
                            <Text style={[styles.chipName, { color: palette.text }]}>you</Text>
                            <Text style={[styles.chipMeta, { color: palette.textMuted }]}>founder</Text>
                        </View>
                        {picked.map((p) => (
                            <Pressable
                                key={p.user_id}
                                onPress={() => removePick(p.user_id)}
                                style={[styles.chip, { backgroundColor: palette.surfaceJournal }]}
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${p.display_name}`}
                            >
                                <Avatar name={p.display_name} url={p.avatar_url} size={28} palette={palette} />
                                <Text style={[styles.chipName, { color: palette.text }]} numberOfLines={1}>
                                    {p.display_name}
                                </Text>
                                <Ionicons name="close" size={14} color={palette.textMuted} />
                            </Pressable>
                        ))}
                    </View>

                    {/* Search row */}
                    <View style={[styles.searchRow, { borderBottomColor: searchFocused ? palette.primary : palette.outlineVariant }]}>
                        <Ionicons name="search" size={19} color={searchFocused ? palette.textSecondary : palette.textMuted} />
                        <TextInput
                            value={query}
                            onChangeText={setQuery}
                            onFocus={() => setSearchFocused(true)}
                            onBlur={() => setSearchFocused(false)}
                            placeholder="Search friends by name…"
                            placeholderTextColor={palette.textMuted}
                            style={[styles.searchInput, { color: palette.text }]}
                            selectionColor={palette.primary}
                            autoCapitalize="none"
                            autoCorrect={false}
                            returnKeyType="search"
                        />
                        {query.length > 0 ? (
                            <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                                <Ionicons name="close-circle" size={18} color={palette.textMuted} />
                            </Pressable>
                        ) : null}
                    </View>

                    {/* Results while searching, else invite-by-link */}
                    {searching ? (
                        (results?.length ?? 0) > 0 ? (
                            <View style={styles.resultsWrap}>
                                {(results ?? []).map((row) => (
                                    <ResultRow
                                        key={row.user_id}
                                        row={row}
                                        palette={palette}
                                        added={pickedIds.has(row.user_id)}
                                        onToggle={() => togglePick(row)}
                                    />
                                ))}
                            </View>
                        ) : isFetching ? (
                            <View style={styles.centerBlock}>
                                <ActivityIndicator color={palette.primary} />
                            </View>
                        ) : (
                            <View style={styles.centerBlock}>
                                <Ionicons name="person-outline" size={32} color={palette.textMuted} style={{ opacity: 0.5 }} />
                                <Text style={[styles.emptyTitle, { color: palette.text }]}>no one to add yet</Text>
                                <Text style={[styles.emptyBody, { color: palette.textMuted }]}>
                                    create now — add them once they follow you back.
                                </Text>
                            </View>
                        )
                    ) : (
                        <View style={styles.linkRow}>
                            <Ionicons name="link-outline" size={19} color={palette.secondary} />
                            <View style={styles.linkText}>
                                <Text style={[styles.linkTitle, { color: palette.text }]}>Invite by link</Text>
                            </View>
                            <Pressable
                                onPress={() => Alert.alert('Coming soon', 'Invite links for friends not yet on Napkin are on the way.')}
                                hitSlop={8}
                                accessibilityRole="button"
                                accessibilityLabel="Copy invite link"
                            >
                                <Text style={[styles.copy, { color: palette.primary }]}>Copy</Text>
                            </Pressable>
                        </View>
                    )}
                </View>
            </ScrollView>

            {/* CTA */}
            <View style={[styles.ctaBar, { backgroundColor: palette.background, paddingBottom: insets.bottom + 24 }]}>
                <Pressable
                    onPress={handleCreate}
                    disabled={!canCreate}
                    style={[
                        styles.ctaBtn,
                        { backgroundColor: palette.primary },
                        canCreate ? styles.ctaBtnEnabled : styles.ctaBtnDisabled,
                        canCreate ? { shadowColor: palette.primary } : null,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: !canCreate }}
                    accessibilityLabel="Create table"
                >
                    {creating ? (
                        <View style={styles.ctaCreatingRow}>
                            <Text style={styles.ctaText}>Setting the table</Text>
                            <CreatingDots />
                        </View>
                    ) : (
                        <Text style={styles.ctaText}>Create table</Text>
                    )}
                </Pressable>
            </View>
        </View>
    );
}

// ── ResultRow ────────────────────────────────────────────────────────────────

function ResultRow({
    row,
    palette,
    added,
    onToggle,
}: {
    row: UserSearchResult;
    palette: Palette;
    added: boolean;
    onToggle: () => void;
}) {
    const isMutual = row.is_mutual !== false;

    return (
        <View style={styles.resultRow}>
            <Avatar name={row.display_name} url={row.avatar_url} size={40} palette={palette} />
            <View style={styles.resultText}>
                <Text style={[styles.resultName, { color: isMutual ? palette.text : palette.textMuted }]} numberOfLines={1}>
                    {row.display_name}
                </Text>
                {!isMutual ? (
                    <Text style={[styles.resultSub, { color: palette.textMuted }]}>needs to follow you back</Text>
                ) : null}
            </View>

            {!isMutual ? null : added ? (
                <Pressable onPress={onToggle} style={styles.addedBtn} accessibilityRole="button" accessibilityLabel={`Remove ${row.display_name}`}>
                    <Ionicons name="checkmark" size={13} color={palette.secondary} />
                    <Text style={[styles.addedText, { color: palette.textMuted }]}>added</Text>
                </Pressable>
            ) : (
                <Pressable
                    onPress={onToggle}
                    style={[styles.addBtn, { backgroundColor: palette.secondaryContainer }]}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${row.display_name}`}
                >
                    <Ionicons name="add" size={14} color={palette.secondary} />
                    <Text style={[styles.addText, { color: palette.secondary }]}>add</Text>
                </Pressable>
            )}
        </View>
    );
}

// ── CreatingDots ──────────────────────────────────────────────────────────────

function CreatingDots() {
    const dots = useRef([new Animated.Value(0.28), new Animated.Value(0.28), new Animated.Value(0.28)]).current;

    useEffect(() => {
        const loops = dots.map((d, i) =>
            Animated.loop(
                Animated.sequence([
                    Animated.delay(i * 180),
                    Animated.timing(d, { toValue: 1, duration: 440, useNativeDriver: true }),
                    Animated.timing(d, { toValue: 0.28, duration: 440, useNativeDriver: true }),
                    Animated.delay((2 - i) * 180),
                ]),
            ),
        );
        loops.forEach((l) => l.start());
        return () => loops.forEach((l) => l.stop());
    }, [dots]);

    return (
        <View style={styles.dotsRow}>
            {dots.map((d, i) => (
                <Animated.View key={i} style={[styles.dot, { opacity: d }]} />
            ))}
        </View>
    );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: { flex: 1 },
    flex: { flex: 1 },
    scrollContent: { paddingHorizontal: GUTTER, paddingTop: 6, paddingBottom: 16 },

    handleWrap: { alignItems: 'center', paddingTop: 9, paddingBottom: 2 },
    handle: { width: 36, height: 5, borderRadius: 9999 },

    cancel: { fontFamily: 'Manrope_500Medium', fontSize: 15, paddingVertical: 4 },

    // Shared field label
    fieldLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.6,
        textTransform: 'uppercase',
    },

    // Name
    nameSection: { paddingTop: 24 },
    nameUnderline: { borderBottomWidth: 2, paddingBottom: 9, marginTop: 12 },
    nameInput: {
        fontFamily: 'Newsreader_500Medium_Italic',
        fontSize: 26,
        lineHeight: 31,
        padding: 0,
    },
    // Invite
    inviteSection: { paddingTop: 28 },
    inviteHeaderRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    optional: { fontFamily: 'Manrope_400Regular', fontSize: 12 },

    chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        paddingVertical: 5,
        paddingLeft: 5,
        paddingRight: 14,
        borderRadius: 9999,
        maxWidth: 220,
    },
    chipName: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, flexShrink: 1 },
    chipMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11.5 },

    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 11,
        marginTop: 18,
        paddingBottom: 10,
        borderBottomWidth: 1,
    },
    searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 15, padding: 0 },

    // Results
    resultsWrap: { marginTop: 4 },
    resultRow: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11 },
    resultText: { flex: 1, minWidth: 0 },
    resultName: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
    resultSub: { fontFamily: 'Manrope_500Medium', fontSize: 12, marginTop: 3 },
    addBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 16, borderRadius: 999 },
    addText: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
    addedBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 8, paddingHorizontal: 14 },
    addedText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },

    centerBlock: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 28 },
    emptyTitle: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 20, lineHeight: 26, marginTop: 14 },
    emptyBody: { fontFamily: 'Manrope_500Medium', fontSize: 13, lineHeight: 21, textAlign: 'center', marginTop: 9, maxWidth: 250 },

    // Invite by link
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 20 },
    linkText: { flex: 1, minWidth: 0 },
    linkTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
    copy: { fontFamily: 'Manrope_700Bold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' },

    // CTA
    ctaBar: { paddingHorizontal: GUTTER, paddingTop: 10 },
    ctaBtn: { width: '100%', paddingVertical: 16, borderRadius: 9999, alignItems: 'center', justifyContent: 'center' },
    ctaBtnEnabled: { shadowOpacity: 0.2, shadowRadius: 16, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
    ctaBtnDisabled: { opacity: 0.34 },
    ctaText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, letterSpacing: 0.2, color: '#fff' },
    ctaCreatingRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    dotsRow: { flexDirection: 'row', gap: 4 },
    dot: { width: 5, height: 5, borderRadius: 99, backgroundColor: '#fff' },
});
