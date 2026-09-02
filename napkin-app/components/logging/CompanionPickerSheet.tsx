/**
 * CompanionPickerSheet — bottom sheet for tagging companions on a meal log.
 *
 * TICKET-027. Shell cloned from TableSwitcherSheet (same Modal + Animated.spring
 * + PanResponder pattern).
 *
 * Body:
 *   1. Search TextInput at top
 *   2. "Recent" chips section (top 5 by frequency) — hidden when empty
 *   3. Results list from debounced user search below
 *   4. Tap to toggle selection (checkmark indicates selected)
 *
 * Self-tagging is blocked by the caller (composer passes selectedIds that exclude self).
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
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
    ActivityIndicator,
    Platform,
    useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useUserSearch } from '@/hooks/users/useUserSearch';
import { useRecentCompanions } from '@/hooks/users/useRecentCompanions';
import type { UserSearchResult } from '@/hooks/users/useUserSearch';

type Palette = typeof Colors.light;

interface Props {
    visible: boolean;
    /** Dismiss without committing staged changes. */
    onClose: () => void;
    /** Explicit confirmation. Defaults to onClose for create flows that edit live. */
    onConfirm?: () => void;
    saving?: boolean;
    selectedIds: Set<string>;
    onToggle: (user: UserSearchResult) => void;
    currentUserId?: string;
    palette: Palette;
}

const DRAG_DISMISS_THRESHOLD = 80;
const SHEET_HEIGHT = 500;
const DEBOUNCE_MS = 300;

export function CompanionPickerSheet({
    visible,
    onClose,
    onConfirm,
    saving = false,
    selectedIds,
    onToggle,
    currentUserId,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();
    const { height: windowHeight } = useWindowDimensions();
    const keyboardHeight = useKeyboardHeight();
    const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;
    const onCloseRef = useRef(onClose);
    const savingRef = useRef(saving);

    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const { data: recentCompanions, isLoading: loadingRecent } = useRecentCompanions(currentUserId);
    const { data: searchResults, isLoading: loadingSearch } = useUserSearch(
        debouncedQuery,
        visible,
        { mutualOnly: true },
    );

    useEffect(() => {
        onCloseRef.current = onClose;
        savingRef.current = saving;
    }, [onClose, saving]);

    const requestClose = useCallback(() => {
        if (!savingRef.current) onCloseRef.current();
    }, []);

    // ── Debounce query ─────────────────────────────────────────────────────
    const handleQueryChange = useCallback((text: string) => {
        setQuery(text);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedQuery(text.trim());
        }, DEBOUNCE_MS);
    }, []);

    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    // Reset query when sheet closes
    useEffect(() => {
        if (!visible) {
            setQuery('');
            setDebouncedQuery('');
        }
    }, [visible]);

    // ── Open / close animation (cloned from TableSwitcherSheet) ───────────
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

    // ── Pan responder for drag-to-dismiss ─────────────────────────────────
    const panResponder = useRef(
        PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 6,
            onPanResponderMove: (_, gs) => {
                if (gs.dy > 0) dragY.setValue(gs.dy);
            },
            onPanResponderRelease: (_, gs) => {
                if (gs.dy > DRAG_DISMISS_THRESHOLD || gs.vy > 0.8) {
                    requestClose();
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

    // Pad the bottom-anchored sheet above the iOS keyboard so every search
    // result remains visible and tappable. Android retains adjustResize.
    const kbPad = Platform.OS === 'ios' ? keyboardHeight : 0;
    const sheetHeight = Math.min(
        SHEET_HEIGHT + kbPad,
        windowHeight - insets.top - Spacing.xl,
    );

    // ── Decide what to show in the list ───────────────────────────────────
    const showSearch = debouncedQuery.length > 0;
    const displayResults = showSearch
        ? (searchResults ?? []).filter((user) => user.is_mutual === true)
        : [];

    // Recent companions filtered by not-already-excluded (e.g. self excluded server-side)
    const recent = (recentCompanions ?? []).filter((u) => u.user_id !== currentUserId);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={requestClose}
            statusBarTranslucent
        >
            {/* Backdrop */}
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
                <Pressable
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    onPress={requestClose}
                    accessibilityLabel="Close companion picker"
                />
            </Animated.View>

            {/* Sheet */}
            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        height: sheetHeight,
                        paddingBottom: kbPad > 0 ? kbPad + Spacing.sm : insets.bottom + Spacing.md,
                        transform: [{ translateY: sheetTranslate }],
                    },
                ]}
            >
                {/* Drag handle */}
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                </View>

                {/* Title */}
                <View style={styles.titleRow}>
                    <Text style={[styles.sheetTitle, { color: palette.text }]}>
                        Who were you with?
                    </Text>
                    <Pressable
                        onPress={onConfirm ?? onClose}
                        disabled={saving}
                        style={styles.doneButton}
                        accessibilityRole="button"
                        accessibilityLabel="Save companions"
                        accessibilityState={{ busy: saving, disabled: saving }}
                    >
                        {saving ? (
                            <ActivityIndicator size="small" color={palette.primary} />
                        ) : (
                            <Text style={[styles.doneLabel, { color: palette.primary }]}>Done</Text>
                        )}
                    </Pressable>
                </View>

                {/* Search input */}
                <View
                    style={[
                        styles.searchRow,
                        { backgroundColor: palette.surfaceContainerHigh },
                    ]}
                >
                    <Ionicons name="search-outline" size={16} color={palette.textMuted} />
                    <TextInput
                        style={[styles.searchInput, { color: palette.text }]}
                        placeholder="Search friends"
                        placeholderTextColor={palette.textMuted}
                        value={query}
                        onChangeText={handleQueryChange}
                        editable={!saving}
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="search"
                    />
                    {query.length > 0 ? (
                        <Pressable onPress={() => handleQueryChange('')} hitSlop={6}>
                            <Ionicons name="close-circle" size={16} color={palette.textMuted} />
                        </Pressable>
                    ) : null}
                </View>

                <ScrollView
                    style={{ flex: 1 }}
                    keyboardShouldPersistTaps="handled"
                    showsVerticalScrollIndicator={false}
                >
                    {/* Recent section — only shown when not searching */}
                    {!showSearch && recent.length > 0 ? (
                        <>
                            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                RECENT
                            </Text>
                            {recent.map((user) => (
                                <UserRow
                                    key={user.user_id}
                                    user={user}
                                    selected={selectedIds.has(user.user_id)}
                                    onToggle={() => onToggle(user)}
                                    disabled={saving}
                                    palette={palette}
                                />
                            ))}
                        </>
                    ) : null}

                    {/* Search results */}
                    {showSearch ? (
                        loadingSearch ? (
                            <ActivityIndicator
                                size="small"
                                color={palette.textMuted}
                                style={{ marginTop: Spacing.lg }}
                            />
                        ) : displayResults.length > 0 ? (
                            <>
                                <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                                    RESULTS
                                </Text>
                                {displayResults.map((user) => (
                                    <UserRow
                                        key={user.user_id}
                                        user={user}
                                        selected={selectedIds.has(user.user_id)}
                                        onToggle={() => onToggle(user)}
                                        disabled={saving}
                                        palette={palette}
                                    />
                                ))}
                            </>
                        ) : (
                            <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                                no mutual follows match
                            </Text>
                        )
                    ) : null}

                    {/* Empty recent — guide the user */}
                    {!showSearch && recent.length === 0 && !loadingRecent ? (
                        <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                            Search friends
                        </Text>
                    ) : null}
                </ScrollView>
            </Animated.View>
        </Modal>
    );
}

// ── UserRow ────────────────────────────────────────────────────────────────

interface UserRowProps {
    user: UserSearchResult;
    selected: boolean;
    onToggle: () => void;
    disabled?: boolean;
    palette: Palette;
}

function UserRow({ user, selected, onToggle, disabled = false, palette }: UserRowProps) {
    const initials = user.display_name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    return (
        <Pressable
            onPress={onToggle}
            disabled={disabled}
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
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={user.display_name}
        >
            {/* Avatar initials */}
            <View
                style={[
                    styles.avatar,
                    {
                        backgroundColor: selected
                            ? palette.primary
                            : palette.surfaceContainerHigh,
                    },
                ]}
            >
                <Text
                    style={[
                        styles.initials,
                        { color: selected ? '#fff' : palette.textSecondary },
                    ]}
                >
                    {initials}
                </Text>
            </View>

            <Text
                style={[
                    styles.userName,
                    { color: selected ? palette.primary : palette.text },
                ]}
                numberOfLines={1}
            >
                {user.display_name}
            </Text>

            {selected ? (
                <Ionicons name="checkmark" size={18} color={palette.primary} />
            ) : null}
        </Pressable>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

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
    doneButton: {
        minWidth: 52,
        minHeight: 44,
        alignItems: 'flex-end',
        justifyContent: 'center',
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
    sectionLabel: {
        ...Type.labelSmall,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.xs,
    },
    emptyText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        textAlign: 'center',
        paddingTop: Spacing.xl,
        paddingHorizontal: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.md,
        gap: Spacing.md,
    },
    avatar: {
        width: 36,
        height: 36,
        borderRadius: 18,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    initials: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    userName: {
        flex: 1,
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
    },
});
