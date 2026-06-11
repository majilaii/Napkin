/**
 * /wishlist — personal wishlist + lists area (TICKET-069 canvas restyle, TICKET-074).
 *
 * Canvas anatomy:
 *   Header: italic serif 26 "Wishlist" + quiet "share · import" affordances
 *           (+ back ‹ when pushed). Share promoted from the kicker murmur (074).
 *   Imports section: PendingSaveCard rows (pending / needs_confirm captures)
 *   "PINNED · {N}" kicker + flat rows: 52px r12 initial-tile · italic serif 17 name
 *                                        muted 12 meta (city · cuisine) · pin icon
 *   E· empty slab when no pinned items
 *   "YOUR LISTS" kicker + rows (italic serif 17 name · muted "{N} spots" · quiet
 *   terracotta `share`) + "+ new list" murmur → /list/new (TICKET-074)
 *
 * TICKET-060 corrections: pending/needs_confirm → CorrectModal flow preserved.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Modal,
    TextInput,
    FlatList,
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { ImportLinkSheet, PendingSaveCard, HandoffSheet } from '@/components/wishlist';
import { buildListsSectionRows } from '@/components/wishlist/listsSectionUtils';
import { useMyWishlist, type PersonalWishlistItem } from '@/hooks/wishlist/useMyWishlist';
import { useCorrectImport } from '@/hooks/wishlist/useCorrectImport';
import { useMyLists } from '@/hooks/lists/useMyLists';
import { callEdgeFn } from '@/lib/edgeInvoke';
import type { WishlistSourceHandoff } from '@/lib/types/wishlistSource';

// ── Inline Places search for correction ────────────────────────────────────────

interface SearchResult {
    id: string;
    name: string;
    city: string | null;
    cuisine: string | null;
}

function usePlacesSearch(query: string) {
    const [results, setResults] = React.useState<SearchResult[]>([]);
    const [isLoading, setIsLoading] = React.useState(false);

    React.useEffect(() => {
        if (query.trim().length < 2) {
            setResults([]);
            return;
        }
        let cancelled = false;
        setIsLoading(true);
        callEdgeFn<{ data?: SearchResult[] } | SearchResult[]>('places-search', {
            body: { query: query.trim(), limit: 8 },
        })
            .then((res) => {
                if (cancelled) return;
                const list = Array.isArray(res) ? res : ((res as any)?.data ?? []);
                setResults(list.slice(0, 8));
            })
            .catch(() => { if (!cancelled) setResults([]); })
            .finally(() => { if (!cancelled) setIsLoading(false); });
        return () => { cancelled = true; };
    }, [query]);

    return { results, isLoading };
}

// ── Correction modal ───────────────────────────────────────────────────────────

interface CorrectModalProps {
    visible: boolean;
    item: PersonalWishlistItem | null;
    userId: string;
    onDone: () => void;
    palette: typeof Colors.light;
}

function CorrectModal({ visible, item, userId, onDone, palette }: CorrectModalProps) {
    const [query, setQuery] = useState('');
    const { results, isLoading } = usePlacesSearch(query);
    const { mutate: correct, isPending } = useCorrectImport(userId);

    const handleSelect = useCallback((r: SearchResult) => {
        if (!item?.job_id) return;
        correct(
            { job_id: item.job_id, restaurant_id: r.id, restaurantName: r.name ?? undefined },
            { onSettled: () => { setQuery(''); onDone(); } },
        );
    }, [correct, item, onDone]);

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onDone}
        >
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1, backgroundColor: palette.background }}
            >
                <View style={[correctStyles.header, { borderBottomColor: palette.dividerSoft }]}>
                    <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 17 }]}>
                        find the right one
                    </Text>
                    <Pressable onPress={onDone} hitSlop={12}>
                        <Ionicons name="close" size={22} color={palette.textMuted} />
                    </Pressable>
                </View>
                <View style={correctStyles.inputRow}>
                    <TextInput
                        value={query}
                        onChangeText={setQuery}
                        placeholder="search by name or city"
                        placeholderTextColor={palette.textMuted}
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                        style={[
                            correctStyles.input,
                            { color: palette.text, borderBottomColor: palette.ruleInkSoft },
                        ]}
                    />
                </View>
                {isPending || isLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.lg }} />
                ) : (
                    <FlatList
                        data={results}
                        keyExtractor={(r) => r.id}
                        keyboardShouldPersistTaps="handled"
                        contentContainerStyle={{ paddingHorizontal: 22, paddingTop: Spacing.sm }}
                        renderItem={({ item: r }) => (
                            <Pressable
                                onPress={() => handleSelect(r)}
                                style={[correctStyles.resultRow, { borderBottomColor: palette.dividerSoft }]}
                            >
                                <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 15 }]}>
                                    {r.name}
                                </Text>
                                {r.city || r.cuisine ? (
                                    <Text style={[Type.bodySmall, { color: palette.textMuted }]}>
                                        {[r.city, r.cuisine].filter(Boolean).join(' · ')}
                                    </Text>
                                ) : null}
                            </Pressable>
                        )}
                    />
                )}
            </KeyboardAvoidingView>
        </Modal>
    );
}

const correctStyles = StyleSheet.create({
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    inputRow: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    input: {
        fontSize: 15,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    resultRow: {
        paddingVertical: 12,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
});

// ── Pinned row ─────────────────────────────────────────────────────────────────

interface PinnedRowProps {
    item: PersonalWishlistItem;
    palette: typeof Colors.light;
    onPress: () => void;
}

function PinnedRow({ item, palette, onPress }: PinnedRowProps) {
    const r = item.restaurant!;
    const initial = r.name.trim()[0]?.toUpperCase() ?? '?';
    // TICKET-072 ARCH-2 #8: append provenance murmur for handoff-sourced spots
    const provenance = item.source?.type === 'handoff'
        ? `via ${(item.source as WishlistSourceHandoff).sharer_name}'s napkin`
        : null;
    const meta = [r.city, r.cuisine, provenance].filter(Boolean).join(' · ');

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [styles.pinnedRow, { opacity: pressed ? 0.75 : 1 }]}
            accessibilityLabel={`Open ${r.name}`}
        >
            {/* 52px r12 initial tile */}
            <View style={[styles.pinnedTile, { backgroundColor: palette.surfaceContainerHigh }]}>
                <Text style={[styles.pinnedTileInitial, { color: palette.textSecondary }]}>
                    {initial}
                </Text>
            </View>

            {/* Name + meta */}
            <View style={styles.pinnedTextBlock}>
                <Text style={[styles.pinnedName, { color: palette.text }]} numberOfLines={1}>
                    {r.name}
                </Text>
                {meta ? (
                    <Text style={[styles.pinnedMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        {meta}
                    </Text>
                ) : null}
            </View>

            {/* Pin icon */}
            <Ionicons name="location-outline" size={18} color={palette.primary} />
        </Pressable>
    );
}

// ── Main screen ────────────────────────────────────────────────────────────────

export default function WishlistScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();
    const insets = useSafeAreaInsets();

    const [importSheetVisible, setImportSheetVisible] = useState(false);
    const [correctItem, setCorrectItem] = useState<PersonalWishlistItem | null>(null);
    // One HandoffSheet target for both modes: wishlist share (no listId) or a
    // per-list share (listId + frozen listName) — TICKET-074.
    const [shareTarget, setShareTarget] = useState<{
        listId?: string;
        listName?: string;
        count: number;
    } | null>(null);

    const { data: wishlistPages, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useMyWishlist(user?.id);

    // YOUR LISTS — TICKET-074 lists area. FRIEND_TEST.hideLists is deliberately
    // bypassed at THIS call-site only — the flag still curtains the old standalone
    // entry points (settings row, ProfileScreenBody palate section). Same pattern
    // as TopFour on the profile tab.
    const { data: myLists } = useMyLists(user?.id);
    const listRows = useMemo(() => buildListsSectionRows(myLists), [myLists]);

    const allItems = useMemo(
        () => (wishlistPages?.pages ?? []).flatMap((p) => p.data ?? []),
        [wishlistPages],
    );

    // Pending/needs_confirm captures at the top
    const pendingRows = useMemo(
        () => allItems.filter((i) =>
            i.extraction_status === 'pending' || i.extraction_status === 'needs_confirm',
        ),
        [allItems],
    );

    // Pinned = resolved items with a restaurant
    const pinnedRows = useMemo(
        () => allItems.filter((i) =>
            i.restaurant != null &&
            i.extraction_status !== 'pending' &&
            i.extraction_status !== 'needs_confirm',
        ),
        [allItems],
    );

    const handleConfirm = useCallback((item: PersonalWishlistItem) => {
        setCorrectItem(item);
    }, []);

    const handlePinnedRowPress = useCallback((item: PersonalWishlistItem) => {
        if (item.restaurant?.id) {
            router.push(('/restaurant/' + item.restaurant.id) as any);
        }
    }, [router]);

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            {/* Header */}
            <View
                style={[
                    styles.header,
                    {
                        backgroundColor: palette.background,
                        paddingTop: insets.top + Spacing.sm,
                    },
                ]}
            >
                {/* Back button — only when actually pushed onto a stack.
                    Wishlist is a TAB root (TICKET-070); from the tab there is
                    nothing to pop, so no chevron. */}
                {router.canGoBack() ? (
                    <Pressable
                        onPress={() => router.back()}
                        hitSlop={12}
                        style={styles.headerBack}
                        accessibilityLabel="back"
                    >
                        <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                    </Pressable>
                ) : (
                    <View style={styles.headerBack} />
                )}

                <Text style={[styles.headerTitle, { color: palette.text }]}>
                    Wishlist
                </Text>

                {/* TICKET-074: share promoted from the kicker murmur to the header,
                    beside import — "share · import", both quiet text affordances. */}
                <View style={styles.headerActions}>
                    {pinnedRows.length > 0 ? (
                        <>
                            <Pressable
                                onPress={() => setShareTarget({ count: pinnedRows.length })}
                                hitSlop={12}
                                accessibilityLabel="share wishlist"
                            >
                                <Text style={[styles.headerActionLabel, { color: palette.primary }]}>
                                    share
                                </Text>
                            </Pressable>
                            <Text style={[styles.headerActionDot, { color: palette.textMuted }]}>
                                ·
                            </Text>
                        </>
                    ) : null}
                    <Pressable
                        onPress={() => setImportSheetVisible(true)}
                        hitSlop={12}
                        accessibilityLabel="import from link"
                    >
                        <Text style={[styles.headerActionLabel, { color: palette.primary }]}>
                            import
                        </Text>
                    </Pressable>
                </View>
            </View>

            <ScrollView
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                showsVerticalScrollIndicator={false}
            >
                {/* Imports / pending section */}
                {pendingRows.length > 0 ? (
                    <View style={styles.pendingSection}>
                        {pendingRows.map((item) => (
                            <PendingSaveCard
                                key={item.id}
                                status={item.extraction_status as 'pending' | 'needs_confirm'}
                                restaurantName={item.restaurant?.name}
                                restaurantCity={item.restaurant?.city}
                                restaurantCuisine={item.restaurant?.cuisine}
                                restaurantPhotoUrl={item.restaurant?.photo_url}
                                onConfirm={
                                    item.extraction_status === 'needs_confirm'
                                        ? () => handleConfirm(item)
                                        : undefined
                                }
                            />
                        ))}
                    </View>
                ) : null}

                {/* Pinned section */}
                {isLoading && allItems.length === 0 ? (
                    <View style={styles.loadingCenter}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : pinnedRows.length > 0 ? (
                    <View style={styles.pinnedSection}>
                        {/* "PINNED · N" kicker — share moved to the header (TICKET-074) */}
                        <Text style={[styles.kicker, { color: palette.textSecondary }]}>
                            {`PINNED · ${pinnedRows.length}`}
                        </Text>

                        {pinnedRows.map((item) => (
                            <PinnedRow
                                key={item.id}
                                item={item}
                                palette={palette}
                                onPress={() => handlePinnedRowPress(item)}
                            />
                        ))}

                        {/* Load more */}
                        {hasNextPage && !isFetchingNextPage ? (
                            <Pressable
                                onPress={() => fetchNextPage()}
                                style={styles.loadMoreRow}
                            >
                                <Text style={[styles.loadMoreLabel, { color: palette.textMuted }]}>
                                    more
                                </Text>
                            </Pressable>
                        ) : isFetchingNextPage ? (
                            <ActivityIndicator
                                color={palette.primary}
                                style={styles.loadMoreRow}
                                size="small"
                            />
                        ) : null}
                    </View>
                ) : !isLoading ? (
                    /* E· empty slab */
                    <View style={styles.emptySlab}>
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            — nothing pinned yet.
                        </Text>
                        <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
                            save a restaurant to remember it.
                        </Text>
                    </View>
                ) : null}

                {/* YOUR LISTS — TICKET-074 lists area. Curated, themed lists: stories
                    you share. They never feed Table overlap (wishlist-only doctrine). */}
                <View style={styles.listsSection}>
                    <Text style={[styles.kicker, { color: palette.textSecondary }]}>
                        YOUR LISTS
                    </Text>

                    {listRows.map((row) => (
                        <View key={row.id} style={styles.listRow}>
                            <Pressable
                                onPress={() => router.push(`/list/${row.id}` as any)}
                                style={({ pressed }) => [
                                    styles.listRowBody,
                                    { opacity: pressed ? 0.75 : 1 },
                                ]}
                                accessibilityLabel={`Open list ${row.name}`}
                            >
                                <Text
                                    style={[styles.listName, { color: palette.text }]}
                                    numberOfLines={1}
                                >
                                    {row.name}
                                </Text>
                                <Text style={[styles.listMeta, { color: palette.textMuted }]}>
                                    {row.metaLabel}
                                </Text>
                            </Pressable>
                            {row.canShare ? (
                                <Pressable
                                    onPress={() =>
                                        setShareTarget({
                                            listId: row.id,
                                            listName: row.name,
                                            count: row.spotCount,
                                        })
                                    }
                                    hitSlop={10}
                                    accessibilityLabel={`share ${row.name}`}
                                >
                                    <Text style={[styles.headerActionLabel, { color: palette.primary }]}>
                                        share
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ))}

                    {/* + new list murmur → existing create-list flow */}
                    <Pressable
                        onPress={() => router.push('/list/new' as any)}
                        hitSlop={8}
                        style={({ pressed }) => [
                            styles.newListRow,
                            { opacity: pressed ? 0.65 : 1 },
                        ]}
                        accessibilityLabel="new list"
                    >
                        <Text style={[styles.newListLabel, { color: palette.textMuted }]}>
                            + new list
                        </Text>
                    </Pressable>
                </View>
            </ScrollView>

            <ImportLinkSheet
                visible={importSheetVisible}
                onDismiss={() => setImportSheetVisible(false)}
            />

            <HandoffSheet
                visible={shareTarget !== null}
                onDismiss={() => setShareTarget(null)}
                pinnedCount={shareTarget?.count ?? 0}
                listId={shareTarget?.listId}
                listName={shareTarget?.listName}
            />

            {user ? (
                <CorrectModal
                    visible={correctItem !== null}
                    item={correctItem}
                    userId={user.id}
                    onDone={() => setCorrectItem(null)}
                    palette={palette}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingBottom: Spacing.md,
        paddingHorizontal: 22,
    },
    headerBack: {
        width: 32,
    },
    headerTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        lineHeight: 30,
        flex: 1,
        textAlign: 'center',
    },
    headerActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    headerActionLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.0,
        textTransform: 'lowercase',
    },
    headerActionDot: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
    // Scroll
    scrollContent: {
        gap: 0,
    },
    loadingCenter: {
        paddingVertical: 60,
        alignItems: 'center',
    },
    // Pending imports
    pendingSection: {
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
        gap: Spacing.xs,
    },
    // Pinned section
    pinnedSection: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    kicker: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    // Pinned row
    pinnedRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 10,
    },
    pinnedTile: {
        width: 52,
        height: 52,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    pinnedTileInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 28,
    },
    pinnedTextBlock: {
        flex: 1,
        gap: 3,
    },
    pinnedName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 20,
    },
    pinnedMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    // Load more
    loadMoreRow: {
        paddingVertical: 14,
        alignItems: 'center',
    },
    loadMoreLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
    // YOUR LISTS section (TICKET-074)
    listsSection: {
        paddingHorizontal: 22,
        paddingTop: Spacing.xl,
    },
    listRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 12,
        paddingVertical: 12,
    },
    listRowBody: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 8,
    },
    listName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 20,
        flexShrink: 1,
    },
    listMeta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    newListRow: {
        paddingVertical: 12,
    },
    newListLabel: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 20,
    },
    // Empty slab
    emptySlab: {
        paddingHorizontal: 22,
        paddingTop: 60,
        gap: 8,
        alignItems: 'center',
    },
    emptyText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 26,
    },
    emptyHint: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});
