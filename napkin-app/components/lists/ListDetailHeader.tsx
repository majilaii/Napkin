/**
 * ListDetailHeader — shown at the top of the list detail screen.
 *
 * Renders: title, optional description, author name/avatar row,
 * entry count + ranked/privacy badges, quiet share · edit affordances
 * (owner only).
 *
 * TICKET-074: share opens the HandoffSheet (frozen-snapshot handoff link via
 * onShare) — replacing the old copy-napkin://-to-clipboard share, which led
 * nowhere for non-users. Handoff shares are snapshots, so they work for
 * private lists too (same doctrine as the private wishlist being shareable).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import type { ListDetail, OwnerProfile } from '@/hooks/lists/useList';

type Palette = typeof Colors.light;

interface Props {
    list: ListDetail;
    entryCount: number;
    ownerProfile: OwnerProfile;
    isOwner: boolean;
    onEdit: () => void;
    /** TICKET-074: open the HandoffSheet for this list. Hidden when the list is empty. */
    onShare?: () => void;
}

export function ListDetailHeader({ list, entryCount, ownerProfile, isOwner, onEdit, onShare }: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;
    const router = useRouter();
    const { user } = useAuth();

    return (
        <View style={styles.container}>
            {/* Title */}
            <Text style={[Type.headlineLarge, { color: palette.text, fontFamily: 'Newsreader_400Regular_Italic' }]}>
                {list.title}
            </Text>

            {/* Description */}
            {list.description ? (
                <Text style={[Type.body, { color: palette.textSecondary, marginTop: Spacing.xs }]}>
                    {list.description}
                </Text>
            ) : null}

            {/* Author row — tappable when public or self (TICKET-020) */}
            {(() => {
                // When viewer is the owner, always route to /u/[currentUserId] (uuid)
                // When target is public, route to /u/[username]
                // Otherwise: plain text
                const authorIdentifier = isOwner
                    ? user?.id
                    : ownerProfile.account_privacy === 'public' && ownerProfile.username
                        ? ownerProfile.username
                        : null;
                const isTappable = !!authorIdentifier;

                const content = (
                    <View style={[styles.authorRow, { marginTop: Spacing.md }]}>
                        <View style={[styles.avatar, { backgroundColor: palette.surfaceContainerHigh }]}>
                            <Ionicons name="person" size={14} color={palette.textMuted} />
                        </View>
                        <Text style={[Type.bodySmall, { color: isTappable ? palette.primary : palette.textMuted }]}>
                            {ownerProfile.display_name ?? 'Unknown'}
                        </Text>
                    </View>
                );

                if (isTappable) {
                    return (
                        <Pressable
                            onPress={() => router.push(`/u/${authorIdentifier}`)}
                            hitSlop={8}
                        >
                            {content}
                        </Pressable>
                    );
                }
                return content;
            })()}

            {/* Badges row */}
            <View style={[styles.badgesRow, { marginTop: Spacing.sm }]}>
                <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                    <Text style={[Type.caption, { color: palette.textSecondary }]}>
                        {entryCount} {entryCount === 1 ? 'place' : 'places'}
                    </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                    <Text style={[Type.caption, { color: palette.textSecondary }]}>
                        {list.ranked ? 'Ranked' : 'Unranked'}
                    </Text>
                </View>
                {isOwner && list.privacy === 'private' && (
                    <View style={[styles.badge, { backgroundColor: palette.surfaceContainerLow }]}>
                        <Ionicons name="lock-closed" size={10} color={palette.textMuted} style={{ marginRight: 3 }} />
                        <Text style={[Type.caption, { color: palette.textMuted }]}>
                            Private
                        </Text>
                    </View>
                )}
            </View>

            {/* Quiet owner affordances: share · edit (canvas idiom — TICKET-074) */}
            {isOwner && (
                <View style={[styles.actionsRow, { marginTop: Spacing.md }]}>
                    {onShare ? (
                        <>
                            <Pressable
                                onPress={onShare}
                                hitSlop={10}
                                accessibilityLabel={`share ${list.title}`}
                            >
                                <Text style={[styles.quietAction, { color: palette.primary }]}>
                                    share
                                </Text>
                            </Pressable>
                            <Text style={[styles.quietDot, { color: palette.textMuted }]}>·</Text>
                        </>
                    ) : null}
                    <Pressable onPress={onEdit} hitSlop={10} accessibilityLabel="edit list">
                        <Text style={[styles.quietAction, { color: palette.textMuted }]}>
                            edit
                        </Text>
                    </Pressable>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    authorRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    avatar: {
        width: 24,
        height: 24,
        borderRadius: Radius.full,
        justifyContent: 'center',
        alignItems: 'center',
    },
    badgesRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        flexWrap: 'wrap',
    },
    badge: {
        borderRadius: Radius.sm,
        paddingHorizontal: 8,
        paddingVertical: 3,
        flexDirection: 'row',
        alignItems: 'center',
    },
    actionsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    quietAction: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.0,
        textTransform: 'lowercase',
        paddingVertical: Spacing.xs,
    },
    quietDot: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 11,
    },
});
