/**
 * AddMemberSheet — bottom sheet for adding a mutual-follow to a Table.
 *
 * Opens with a search field. Results come from useUserSearch(..., { mutualOnly: true }).
 * Mutual rows are selectable and trigger useAddMember on tap.
 * Non-mutual rows render with a muted "Needs to follow you back" label —
 * tapping them routes to that user's profile so the owner can remind them.
 *
 * Implementation: Modal + Animated.spring (same as TableSwitcherSheet — no
 * extra deps). Drag-to-dismiss via PanResponder.
 *
 * Keyboard: the sheet rides above the iOS keyboard via KeyboardAvoidingView
 * (behavior="position", same idiom as CreateListSheet) and its max height
 * shrinks to the space left above the keyboard — the autofocused search field
 * used to sit fully behind the keyboard, which read as "add member is broken."
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    View,
    Text,
    Modal,
    Animated,
    KeyboardAvoidingView,
    PanResponder,
    Platform,
    Pressable,
    FlatList,
    ActivityIndicator,
    StyleSheet,
    Image,
    Alert,
    Share,
    useWindowDimensions,
} from 'react-native';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';
import { track } from '@/lib/track';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Radius } from '@/constants/theme';
import { SearchInput } from '@/components/search/SearchInput';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import { useUserSearch, type UserSearchResult } from '@/hooks/users/useUserSearch';
import { useAddMember, AddMemberError } from '@/hooks/tables/useAddMember';
import { usePendingInvitations } from '@/hooks/tables/usePendingInvitations';
import { useCreateInvite } from '@/hooks/tables/useCreateInvite';

type Palette = typeof Colors.light;

interface AddMemberSheetProps {
    visible: boolean;
    onClose: () => void;
    tableId: string;
    palette: Palette;
    userId: string | null | undefined;
    /** Table name — woven into the invite-link share message. */
    tableName?: string;
}

const DRAG_DISMISS_THRESHOLD = 80;
const SHEET_MAX_HEIGHT = 520;

function initials(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.slice(0, 1).toUpperCase();
}

// ── MutualResultRow ────────────────────────────────────────────────────────

interface MutualResultRowProps {
    row: UserSearchResult;
    palette: Palette;
    onSelect: (row: UserSearchResult) => void;
    onOpenProfile: (userId: string) => void;
    isAdding: boolean;
    /** TICKET-133: this user already has a pending invite → quiet "invited" chip. */
    isInvited: boolean;
}

/** Why a row is non-mutual — uses the directional fields when the server sent them. */
function nonMutualReason(row: UserSearchResult): string {
    if (row.is_following === undefined || row.follows_caller === undefined) {
        return 'needs to follow you back';
    }
    if (!row.is_following && row.follows_caller) return 'follow them back to add';
    if (!row.is_following && !row.follows_caller) return "you don't follow each other yet";
    return 'needs to follow you back';
}

function MutualResultRow({ row, palette, onSelect, onOpenProfile, isAdding, isInvited }: MutualResultRowProps) {
    const isMutual = row.is_mutual === true;
    const reason = isMutual ? null : nonMutualReason(row);
    // An already-invited mutual is non-interactive as an add target — tapping
    // opens their profile rather than re-sending (the invite is already live).
    const selectable = isMutual && !isInvited;

    return (
        <Pressable
            onPress={() => {
                if (selectable) {
                    onSelect(row);
                } else {
                    onOpenProfile(row.user_id);
                }
            }}
            style={({ pressed }) => [
                styles.resultRow,
                { opacity: pressed ? 0.7 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
                isInvited
                    ? `${row.display_name} — invited`
                    : isMutual
                        ? `Add ${row.display_name}`
                        : `${row.display_name} — ${reason}`
            }
        >
            {/* Avatar */}
            <View style={[styles.avatarCircle, { backgroundColor: palette.primaryContainer }]}>
                {row.avatar_url ? (
                    <Image source={{ uri: row.avatar_url }} style={styles.avatarImg} />
                ) : (
                    <Text style={styles.avatarInitials}>{initials(row.display_name)}</Text>
                )}
            </View>

            {/* Name + sub */}
            <View style={styles.rowText}>
                <Text
                    style={[
                        styles.rowName,
                        { color: isMutual ? palette.text : palette.textMuted },
                    ]}
                    numberOfLines={1}
                >
                    {row.display_name}
                </Text>
                {reason != null && (
                    <Text style={[styles.rowSub, { color: palette.textMuted }]}>
                        {reason}
                    </Text>
                )}
            </View>

            {/* Right action */}
            {isInvited ? (
                <Text style={[styles.invitedChip, { color: palette.textMuted }]}>invited</Text>
            ) : isMutual ? (
                isAdding ? (
                    <ActivityIndicator size="small" color={palette.primary} />
                ) : (
                    <Text style={[styles.addCta, { color: palette.primary }]}>Add</Text>
                )
            ) : (
                <Ionicons name="chevron-forward-outline" size={16} color={palette.textMuted} />
            )}
        </Pressable>
    );
}

// ── AddMemberSheet ─────────────────────────────────────────────────────────

export function AddMemberSheet({
    visible,
    onClose,
    tableId,
    palette,
    userId,
    tableName,
}: AddMemberSheetProps) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { height: windowHeight } = useWindowDimensions();
    const keyboardHeight = useKeyboardHeight();
    const translateY = useRef(new Animated.Value(SHEET_MAX_HEIGHT)).current;
    const dragY = useRef(new Animated.Value(0)).current;
    const backdropOpacity = useRef(new Animated.Value(0)).current;

    const [inputValue, setInputValue] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [addingUserId, setAddingUserId] = useState<string | null>(null);

    const { data: searchResults, isFetching } = useUserSearch(debouncedQ, visible, {
        mutualOnly: true,
    });

    const addMember = useAddMember(userId);
    const createInvite = useCreateInvite();
    // Pending invites for this table — backs the quiet "invited" chip so an owner
    // who already invited someone doesn't re-tap "Add". Fetched only while open.
    const { data: pendingInvites } = usePendingInvitations(tableId, visible);

    // Reset state when sheet opens
    useEffect(() => {
        if (visible) {
            setInputValue('');
            setDebouncedQ('');
        }
    }, [visible]);

    // Open / close animation
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
                    toValue: SHEET_MAX_HEIGHT,
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
            onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6,
            onPanResponderMove: (_, g) => {
                if (g.dy > 0) dragY.setValue(g.dy);
            },
            onPanResponderRelease: (_, g) => {
                if (g.dy > DRAG_DISMISS_THRESHOLD || g.vy > 0.8) {
                    onClose();
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

    const handleSelect = useCallback(async (row: UserSearchResult) => {
        if (addingUserId) return; // prevent double-tap
        setAddingUserId(row.user_id);
        try {
            // Sends a pending invitation (TICKET-133) — the invitee accepts before
            // they're seated. Closes on success; the "invited" chip reflects it on reopen.
            await addMember.mutateAsync({ tableId, targetUserId: row.user_id });
            onClose();
        } catch (err) {
            let msg = 'Could not send the invite. Please try again.';
            if (err instanceof AddMemberError) {
                if (err.error_code === 'NOT_MUTUAL_FOLLOW') {
                    msg = `${row.display_name} no longer follows you back. Ask them to follow you first.`;
                } else if (err.error_code === 'NOT_OWNER') {
                    msg = 'Only the table owner can invite members.';
                }
            }
            Alert.alert('Could not invite', msg);
        } finally {
            setAddingUserId(null);
        }
    }, [addingUserId, addMember, tableId, onClose]);

    const handleOpenProfile = useCallback((targetUserId: string) => {
        onClose();
        router.push({ pathname: '/u/[identifier]', params: { identifier: targetUserId } });
    }, [onClose, router]);

    const hasQuery = debouncedQ.trim().length > 0;
    const showEmpty = hasQuery && !isFetching && (searchResults?.length ?? 0) === 0;

    // Fit the sheet in the space left above the keyboard (KAV shifts it up by
    // exactly keyboardHeight, so anything taller would clip off the top).
    const sheetMaxHeight = Math.min(
        SHEET_MAX_HEIGHT,
        windowHeight - keyboardHeight - insets.top - Spacing.xl,
    );

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {/* Backdrop */}
            <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
                <Pressable
                    style={[StyleSheet.absoluteFill, styles.backdrop]}
                    onPress={onClose}
                    accessibilityLabel="Close add member sheet"
                />
            </Animated.View>

            {/* Sheet — rides above the keyboard (same KAV idiom as CreateListSheet) */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'position' : undefined}
                style={styles.avoidingView}
                pointerEvents="box-none"
            >
            <Animated.View
                style={[
                    styles.sheet,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        paddingBottom: insets.bottom + Spacing.md,
                        transform: [{ translateY: sheetTranslate }],
                        maxHeight: sheetMaxHeight,
                    },
                ]}
            >
                {/* Drag handle */}
                <View {...panResponder.panHandlers} style={styles.handleArea}>
                    <View style={[styles.handle, { backgroundColor: palette.outlineVariant }]} />
                </View>

                {/* Title row */}
                <View style={styles.titleRow}>
                    <Text style={[styles.title, { color: palette.text }]}>
                        Add member
                    </Text>
                    <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                        <Ionicons name="close-outline" size={22} color={palette.textMuted} />
                    </Pressable>
                </View>

                {/* Search input */}
                <SearchInput
                    value={inputValue}
                    onChangeImmediate={setInputValue}
                    onChangeDebounced={setDebouncedQ}
                    onClear={() => {
                        setInputValue('');
                        setDebouncedQ('');
                    }}
                    autoFocus={visible}
                    placeholder="Search by name…"
                />

                {/* Results */}
                {!hasQuery ? (
                    <View style={styles.hint}>
                        <Text style={[styles.hintText, { color: palette.textMuted }]}>
                            Only mutual follows can be added.
                        </Text>
                    </View>
                ) : isFetching ? (
                    <View style={styles.hint}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : showEmpty ? (
                    <View style={styles.hint}>
                        <Text style={[styles.hintText, { color: palette.textMuted }]}>
                            No results for &ldquo;{debouncedQ}&rdquo;
                        </Text>
                    </View>
                ) : (
                    <FlatList
                        style={styles.resultsList}
                        data={searchResults ?? []}
                        keyExtractor={(item) => item.user_id}
                        renderItem={({ item }) => (
                            <MutualResultRow
                                row={item}
                                palette={palette}
                                onSelect={handleSelect}
                                onOpenProfile={handleOpenProfile}
                                isAdding={addingUserId === item.user_id}
                                isInvited={pendingInvites?.has(item.user_id) ?? false}
                            />
                        )}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                    />
                )}

                {/* Not on Napkin yet? Mint a real invite link and share it. */}
                <Pressable
                    onPress={async () => {
                        track('invite_sent', { surface: 'add_member_sheet' });
                        const label = tableName ? `"${tableName}"` : 'our table';
                        try {
                            const { join_url } = await createInvite.mutateAsync(tableId);
                            await Share.share({
                                message: TESTFLIGHT_INVITE_URL
                                    ? `join ${label} on Napkin — ${join_url}\n\n${TESTFLIGHT_INVITE_URL}`
                                    : `join ${label} on Napkin — ${join_url}`,
                            });
                        } catch {
                            // Mint failed — share a bare install nudge rather than nothing.
                            void Share.share({
                                message: TESTFLIGHT_INVITE_URL
                                    ? `come join ${label} on Napkin — ${TESTFLIGHT_INVITE_URL}`
                                    : `come join ${label} on Napkin`,
                            });
                        }
                    }}
                    style={({ pressed }) => [styles.shareRow, { opacity: pressed ? 0.7 : 1 }]}
                    accessibilityRole="button"
                >
                    <Ionicons name="paper-plane-outline" size={14} color={palette.primary} />
                    <Text style={[styles.shareRowText, { color: palette.primary }]}>
                        or share an invite link
                    </Text>
                </Pressable>
            </Animated.View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    backdrop: {
        // Warm dusk, not a black scrim (founder, 2026-07-03).
        backgroundColor: 'rgba(74, 55, 42, 0.25)',
    },
    shareRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingVertical: 12,
        marginTop: Spacing.xs,
    },
    shareRowText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
    },
    avoidingView: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
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
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.sm,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        letterSpacing: -0.3,
    },
    hint: {
        paddingVertical: Spacing.xl,
        alignItems: 'center',
    },
    resultsList: {
        flexGrow: 0,
        flexShrink: 1,
    },
    hintText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: Spacing.xl,
    },
    resultRow: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 10,
        gap: Spacing.md,
    },
    avatarCircle: {
        width: 40,
        height: 40,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
    },
    avatarImg: {
        width: 40,
        height: 40,
        borderRadius: Radius.full,
    },
    avatarInitials: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        color: 'rgba(255,255,255,0.92)',
    },
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    rowName: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 15,
    },
    rowSub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 1,
    },
    addCta: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    invitedChip: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.3,
    },
});
