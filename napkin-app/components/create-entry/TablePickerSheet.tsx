/**
 * TablePickerSheet — bottom sheet for picking which Tables to share an entry to.
 *
 * TICKET-043: evolved from single-select (v1) to multi-select.
 *
 * Contract changes from v1:
 *   selectedId → selectedIds (string[])
 *   onSelect   → onCommit (called with the committed ids array)
 *
 * Commit semantics (per spec): Done / backdrop tap / swipe-down / hardware back
 * ALL commit the pending selection — not discard. The chip row behind the sheet
 * already previews pending state; users expect dismiss-to-keep behavior.
 *
 * "Clear all" row at top (replaces v1 "Don't share" row).
 * Skeleton loading + inline error state with retry.
 */
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
    View,
    Text,
    Pressable,
    Modal,
    Animated,
    StyleSheet,
    PanResponder,
    TextInput,
    ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';

type Palette = typeof Colors.light;

export interface TablePickerSheetTable {
    id: string;
    name: string;
}

interface Props {
    visible: boolean;
    tables: TablePickerSheetTable[];
    selectedIds: string[];
    onCommit: (ids: string[]) => void;
    palette: Palette;
    /** True while the table list is loading — shows skeleton rows. */
    isLoading?: boolean;
    /** Non-null when the table list failed to load — shows inline error + retry. */
    loadError?: string | null;
    onRetryLoad?: () => void;
    /** Optional grammar for reuse outside the entry composer. */
    title?: string;
    clearLabel?: string;
}

const DRAG_DISMISS_THRESHOLD = 80;
const SHEET_HEIGHT = 460;
const SKELETON_COUNT = 3;

export function TablePickerSheet({
    visible,
    tables,
    selectedIds,
    onCommit,
    palette,
    isLoading,
    loadError,
    onRetryLoad,
    title = 'Post to a table?',
    clearLabel = 'Clear all — keep it private',
}: Props) {
    const insets = useSafeAreaInsets();
    const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const [query, setQuery] = useState('');
    // Local pending selection — committed on Done / dismiss.
    const [pendingIds, setPendingIds] = useState<string[]>(selectedIds);
    const pendingIdsRef = useRef(selectedIds);
    const onCommitRef = useRef(onCommit);

    useEffect(() => {
        pendingIdsRef.current = pendingIds;
    }, [pendingIds]);

    useEffect(() => {
        onCommitRef.current = onCommit;
    }, [onCommit]);

    // Sync pendingIds when sheet opens with a new external selectedIds.
    useEffect(() => {
        if (visible) {
            setPendingIds(selectedIds);
            pendingIdsRef.current = selectedIds;
            setQuery('');
        }
    }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

    const commit = useCallback(() => {
        onCommitRef.current(pendingIdsRef.current);
    }, []);

    useEffect(() => {
        if (visible) {
            dragY.setValue(0);
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: 0,
                    useNativeDriver: true,
                    damping: 22,
                    stiffness: 220,
                }),
                Animated.timing(backdropOpacity, {
                    toValue: 1,
                    duration: 200,
                    useNativeDriver: true,
                }),
            ]).start();
        } else {
            Animated.parallel([
                Animated.spring(translateY, {
                    toValue: SHEET_HEIGHT,
                    useNativeDriver: true,
                    damping: 30,
                    stiffness: 300,
                }),
                Animated.timing(backdropOpacity, {
                    toValue: 0,
                    duration: 160,
                    useNativeDriver: true,
                }),
            ]).start();
        }
    }, [visible, translateY, dragY, backdropOpacity]);

    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 6,
            onPanResponderMove: (_, gs) => {
                if (gs.dy > 0) dragY.setValue(gs.dy);
            },
            onPanResponderRelease: (_, gs) => {
                if (gs.dy > DRAG_DISMISS_THRESHOLD || gs.vy > 0.8) {
                    commit();
                } else {
                    Animated.spring(dragY, {
                        toValue: 0,
                        useNativeDriver: true,
                        damping: 22,
                        stiffness: 200,
                    }).start();
                }
            },
        })
    ).current;

    const sheetTranslate = Animated.add(translateY, dragY);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return tables;
        return tables.filter(t => t.name.toLowerCase().includes(q));
    }, [query, tables]);

    const toggleTable = (id: string) => {
        setPendingIds(prev => {
            const next = prev.includes(id)
                ? prev.filter(x => x !== id)
                : [...prev, id];
            pendingIdsRef.current = next;
            return next;
        });
    };

    const clearAll = () => {
        pendingIdsRef.current = [];
        setPendingIds([]);
    };

    // Accessibility label for unseen tables on overflow.
    const unseenNames = tables
        .filter(t => !filtered.includes(t))
        .map(t => t.name)
        .join(', ');

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={commit}
            statusBarTranslucent
        >
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
                <Pressable
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    onPress={commit}
                    accessibilityLabel="Close table picker"
                />
            </Animated.View>

            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        paddingBottom: insets.bottom + Spacing.md,
                        transform: [{ translateY: sheetTranslate }],
                    },
                ]}
            >
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                </View>

                <View style={styles.titleRow}>
                    <Text style={[styles.sheetTitle, { color: palette.text }]}>
                        {title}
                    </Text>
                    <Pressable
                        onPress={commit}
                        hitSlop={8}
                        accessibilityLabel="Done"
                        accessibilityRole="button"
                    >
                        <Text style={[styles.doneLabel, { color: palette.primary }]}>Done</Text>
                    </Pressable>
                </View>

                {tables.length > 6 && !isLoading && !loadError ? (
                    <View
                        style={[
                            styles.searchRow,
                            { backgroundColor: palette.surfaceContainerHigh },
                        ]}
                    >
                        <Ionicons name="search-outline" size={16} color={palette.textMuted} />
                        <TextInput
                            style={[styles.searchInput, { color: palette.text }]}
                            placeholder="Search your tables"
                            placeholderTextColor={palette.textMuted}
                            value={query}
                            onChangeText={setQuery}
                            autoCorrect={false}
                            autoCapitalize="none"
                            returnKeyType="search"
                        />
                        {query.length > 0 ? (
                            <Pressable onPress={() => setQuery('')} hitSlop={6}>
                                <Ionicons name="close-circle" size={16} color={palette.textMuted} />
                            </Pressable>
                        ) : null}
                    </View>
                ) : null}

                <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* Loading skeleton */}
                    {isLoading ? (
                        Array.from({ length: SKELETON_COUNT }).map((_, i) => (
                            <SkeletonRow key={i} palette={palette} />
                        ))
                    ) : loadError ? (
                        // Error state with retry
                        <View style={styles.errorContainer}>
                            <Text style={[styles.errorText, { color: palette.textMuted }]}>
                                Couldn&rsquo;t load your tables
                            </Text>
                            {onRetryLoad ? (
                                <Pressable onPress={onRetryLoad} style={styles.retryButton} hitSlop={8}>
                                    <Text style={[styles.retryLabel, { color: palette.primary }]}>
                                        Try again
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : (
                        <>
                            {/* "Clear all" row — clears selection (solo / private) */}
                            <TableRow
                                label={clearLabel}
                                italic
                                selected={pendingIds.length === 0}
                                onPress={clearAll}
                                palette={palette}
                                accessibilityLabel="Clear all table selections"
                            />

                            {filtered.length === 0 && query.trim() ? (
                                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                                    No tables match &ldquo;{query.trim()}&rdquo;
                                </Text>
                            ) : (
                                filtered.map(table => (
                                    <TableRow
                                        key={table.id}
                                        label={table.name}
                                        selected={pendingIds.includes(table.id)}
                                        onPress={() => toggleTable(table.id)}
                                        palette={palette}
                                        accessibilityLabel={table.name}
                                        accessibilityRole="checkbox"
                                    />
                                ))
                            )}

                            {tables.length === 0 && !query.trim() ? (
                                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                                    You&rsquo;re not in any tables yet.
                                </Text>
                            ) : null}

                            {/* Overflow a11y helper — announces unseen tables if query hides them */}
                            {unseenNames ? (
                                <View accessibilityLabel={`More tables: ${unseenNames}`} accessible />
                            ) : null}
                        </>
                    )}
                </ScrollView>
            </Animated.View>
        </Modal>
    );
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface RowProps {
    label: string;
    italic?: boolean;
    selected: boolean;
    onPress: () => void;
    palette: Palette;
    accessibilityLabel?: string;
    accessibilityRole?: 'button' | 'checkbox';
}

function TableRow({
    label,
    italic,
    selected,
    onPress,
    palette,
    accessibilityLabel,
    accessibilityRole = 'button',
}: RowProps) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.row,
                {
                    backgroundColor: selected
                        ? palette.primaryMuted
                        : pressed
                        ? palette.surfaceContainerHigh
                        : 'transparent',
                },
            ]}
            accessibilityRole={accessibilityRole}
            accessibilityState={{ selected, checked: accessibilityRole === 'checkbox' ? selected : undefined }}
            accessibilityLabel={accessibilityLabel ?? label}
        >
            <Text
                style={[
                    styles.rowLabel,
                    {
                        color: selected ? palette.primary : palette.text,
                        fontFamily: italic
                            ? 'Newsreader_400Regular_Italic'
                            : 'Manrope_500Medium',
                        fontStyle: italic ? 'italic' : 'normal',
                    },
                ]}
                numberOfLines={1}
            >
                {label}
            </Text>
            {/* Checkbox indicator for multi-select */}
            {selected ? (
                <Ionicons name="checkbox" size={20} color={palette.primary} />
            ) : (
                <Ionicons name="square-outline" size={20} color={palette.outlineVariant} />
            )}
        </Pressable>
    );
}

function SkeletonRow({ palette }: { palette: Palette }) {
    return (
        <View style={[styles.row, styles.skeletonRow]}>
            <View
                style={[
                    styles.skeletonLine,
                    {
                        backgroundColor: palette.surfaceContainerHigh,
                        width: '60%',
                    },
                ]}
            />
        </View>
    );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        backgroundColor: 'rgba(28, 28, 25, 0.4)',
    },
    sheet: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        shadowColor: '#1c1c19',
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: 0.08,
        shadowRadius: 24,
        elevation: 16,
        minHeight: SHEET_HEIGHT,
        maxHeight: '80%',
    },
    handleArea: {
        alignItems: 'center',
        paddingVertical: Spacing.md,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
    },
    titleRow: {
        flexDirection: 'row',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm + 4,
    },
    sheetTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        letterSpacing: -0.3,
    },
    doneLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
    searchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
        marginHorizontal: Spacing.lg,
        marginBottom: Spacing.sm,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm + 2,
        borderRadius: Radius.md,
    },
    searchInput: {
        flex: 1,
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        padding: 0,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        gap: Spacing.md,
    },
    rowLabel: {
        flex: 1,
        fontSize: 15,
    },
    skeletonRow: {
        paddingVertical: Spacing.md + 4,
    },
    skeletonLine: {
        height: 14,
        borderRadius: 7,
    },
    emptyText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        textAlign: 'center',
        paddingTop: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
    errorContainer: {
        alignItems: 'center',
        paddingTop: Spacing.xl,
        paddingHorizontal: Spacing.lg,
        gap: Spacing.sm,
    },
    errorText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        textAlign: 'center',
    },
    retryButton: {
        paddingVertical: Spacing.sm,
    },
    retryLabel: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
    },
});
