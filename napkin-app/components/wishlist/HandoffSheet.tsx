/**
 * HandoffSheet — share + revoke bottom sheet for the personal wishlist (TICKET-072)
 * and, with listId/listName set, for a single list (TICKET-074).
 *
 * Anatomy:
 *   Header: "your napkin" (or the list name) + ×
 *   "share my napkin" / "share this list" → create mutation → native Share.share
 *   "stop sharing" → confirm alert (journal voice) → revoke_all → toast + dismiss
 *
 * Design decisions:
 * - "while sharing show nothing fancy (the sheet IS the feedback)": the native iOS
 *   Share sheet is the UI feedback for the create flow; no custom confirmation step.
 * - Revoke uses a native Alert (no custom modal) to confirm intent; matches the
 *   "quiet, no settings screen" doctrine. revoke_all is global (wishlist + every
 *   list link) — the only revoke primitive in v1.
 * - Both mutations are fire-and-forget (no optimistic cache, no invalidation).
 * - Copy lives in handoffSheetUtils (pure, unit-tested real exports).
 */
import React from 'react';
import {
    Modal,
    View,
    Text,
    Pressable,
    StyleSheet,
    ActivityIndicator,
    Alert,
    Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useCreateHandoff } from '@/hooks/wishlist/useCreateHandoff';
import { useRevokeHandoffs } from '@/hooks/wishlist/useRevokeHandoffs';
import { useToast } from '@/providers/ToastProvider';
import {
    buildCreateInput,
    buildShareMessage,
    createErrorToast,
    sheetTitle,
    primaryCtaLabel,
} from './handoffSheetUtils';

interface HandoffSheetProps {
    visible: boolean;
    onDismiss: () => void;
    pinnedCount: number;
    /** TICKET-074: when set, the sheet shares THIS list instead of the wishlist. */
    listId?: string;
    /** Used in the share message + sheet copy; required alongside listId. */
    listName?: string;
}

export function HandoffSheet({ visible, onDismiss, pinnedCount, listId, listName }: HandoffSheetProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { show: showToast } = useToast();

    const { mutate: create, isPending: isCreating } = useCreateHandoff();
    const { mutate: revoke, isPending: isRevoking } = useRevokeHandoffs();

    const handleShare = () => {
        create(buildCreateInput(listId), {
            onSuccess: (result) => {
                Share.share({
                    message: buildShareMessage({
                        listName,
                        count: pinnedCount,
                        shareUrl: result.share_url,
                    }),
                });
                // Dismiss the sheet; the native Share sheet takes over
                onDismiss();
            },
            onError: (err) => {
                // callEdgeFn errors carry the structured envelope on .cause
                // ({ code, message, ... }) — branch on EMPTY_WISHLIST/EMPTY_LIST
                // for the specific "nothing confirmed" murmur (fix-pass).
                const code = (err as Error & { cause?: { code?: string } }).cause?.code;
                showToast(createErrorToast(code));
            },
        });
    };

    const handleRevoke = () => {
        Alert.alert(
            'fold away your links?',
            'everyone with a shared link will see a quiet "folded away" page. spots they\'ve already pinned keep living.',
            [
                { text: 'cancel', style: 'cancel' },
                {
                    text: 'stop sharing',
                    style: 'destructive',
                    onPress: () => {
                        revoke(undefined, {
                            onSuccess: () => {
                                showToast('links folded away');
                                onDismiss();
                            },
                            onError: () => {
                                showToast('could not revoke links');
                            },
                        });
                    },
                },
            ],
        );
    };

    const isBusy = isCreating || isRevoking;

    return (
        <Modal
            visible={visible}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={onDismiss}
        >
            <View
                style={[
                    styles.root,
                    {
                        backgroundColor: palette.background,
                        paddingBottom: insets.bottom + Spacing.lg,
                    },
                ]}
            >
                {/* Header — list name (brand-voice italic serif) or "your napkin" */}
                <View style={[styles.header, { borderBottomColor: palette.dividerSoft }]}>
                    <Text style={[styles.headerTitle, { color: palette.text }]} numberOfLines={1}>
                        {sheetTitle(listName)}
                    </Text>
                    <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="close">
                        <Ionicons name="close" size={20} color={palette.textMuted} />
                    </Pressable>
                </View>

                {/* Body */}
                <View style={styles.body}>
                    <Text style={[styles.murmur, { color: palette.textMuted }]}>
                        {`${pinnedCount} spot${pinnedCount !== 1 ? 's' : ''} · stays in sync as you add more`}
                    </Text>

                    {/* Share CTA */}
                    <Pressable
                        onPress={handleShare}
                        disabled={isBusy}
                        style={({ pressed }) => [
                            styles.primaryBtn,
                            { backgroundColor: palette.primary, opacity: pressed || isBusy ? 0.8 : 1 },
                        ]}
                        accessibilityLabel={primaryCtaLabel(listName)}
                    >
                        {isCreating ? (
                            <ActivityIndicator color="#fffdf8" size="small" />
                        ) : (
                            <Text style={[styles.primaryBtnLabel, { color: '#fffdf8' }]}>
                                {primaryCtaLabel(listName)}
                            </Text>
                        )}
                    </Pressable>

                    {/* Revoke link */}
                    <Pressable
                        onPress={handleRevoke}
                        disabled={isBusy}
                        hitSlop={8}
                        style={styles.revokeRow}
                        accessibilityLabel="revoke shared links"
                    >
                        {isRevoking ? (
                            <ActivityIndicator color={palette.textMuted} size="small" />
                        ) : (
                            <Text style={[styles.revokeLabel, { color: palette.textMuted }]}>
                                stop sharing
                            </Text>
                        )}
                    </Pressable>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: 20,
        paddingBottom: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    headerTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        lineHeight: 24,
        flexShrink: 1,
        marginRight: Spacing.md,
    },
    body: {
        paddingHorizontal: 22,
        paddingTop: Spacing.xl,
        gap: Spacing.lg,
    },
    murmur: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        lineHeight: 18,
    },
    primaryBtn: {
        paddingVertical: 14,
        borderRadius: 100,
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: 48,
    },
    primaryBtnLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.4,
        textTransform: 'lowercase',
    },
    revokeRow: {
        alignItems: 'center',
        paddingVertical: Spacing.sm,
    },
    revokeLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});
