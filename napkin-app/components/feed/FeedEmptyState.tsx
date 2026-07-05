/**
 * FeedEmptyState — TICKET-101. The zero-follow feed body: never a bare tab.
 *
 *   Tier 1 (viewer has co-diners on Napkin they don't follow):
 *     up to 3 follow cards (avatar · name · "N meals together" · follow). One
 *     tap follows via the shipped useFollow (optimistic snapshot→patch→rollback);
 *     on success the card is removed AND the friends feed is invalidated so it
 *     refetches with the new author — the empty tab genuinely fills. Following
 *     all shown candidates collapses the block (renders null) and feed.tsx
 *     shows its normal loading/filled state.
 *
 *   Tier 2 (true solo user, nobody they know here yet):
 *     one ghost card (Empty-State Slab grammar — monogram + muted italic em-dash
 *     line) + one invite CTA → native Share.share with the viewer's invite link
 *     (same pattern as AddMemberSheet). Canceling the share is a no-op.
 *
 * The tier boundary is the pure resolveEmptyState() (unit-tested); this
 * component is just the render + follow wiring.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Share } from 'react-native';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

import { Colors, Spacing, Radius } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { queryKeys } from '@/lib/queryKeys';
import { track } from '@/lib/track';
import { TESTFLIGHT_INVITE_URL } from '@/constants/links';
import { useCoDiners } from '@/hooks/feed/useCoDiners';
import { useFollow } from '@/hooks/users/useFollow';
import { resolveEmptyState } from './feedEmptyStateGate';
import { CoDinerFollowCard } from './CoDinerFollowCard';
import { DiscoveryLedger } from './DiscoveryLedger';

export function FeedEmptyState() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const viewerId = user?.id ?? null;

    const { data: candidates } = useCoDiners(viewerId);
    const follow = useFollow();

    // Local optimistic state: which cards the viewer has tapped follow on, and
    // which have been confirmed (removed). Neither touches the query cache —
    // useFollow owns its own cache snapshots; this is purely the card list.
    const [followedIds, setFollowedIds] = useState<Set<string>>(new Set());
    const [removedIds, setRemovedIds] = useState<Set<string>>(new Set());

    const resolution = useMemo(() => resolveEmptyState(candidates), [candidates]);

    const handleFollow = useCallback(
        (targetUserId: string) => {
            // Instant visual — the whole point of tier 1 is proving the tap does
            // something before any network round-trip.
            setFollowedIds((prev) => new Set(prev).add(targetUserId));
            follow.mutate(
                { targetUserId },
                {
                    onSuccess: () => {
                        // Remove the confirmed card; invalidate the friends feed so
                        // it refetches with the newly-followed author included (the
                        // empty tab → loading → filled transition).
                        setRemovedIds((prev) => new Set(prev).add(targetUserId));
                        if (viewerId) {
                            queryClient.invalidateQueries({
                                queryKey: queryKeys.feed.friends(viewerId),
                            });
                        }
                    },
                    onError: () => {
                        // Roll the card back to its unfollowed state (no silent stuck
                        // state); useFollow already rolled back its own caches.
                        setFollowedIds((prev) => {
                            const next = new Set(prev);
                            next.delete(targetUserId);
                            return next;
                        });
                    },
                },
            );
        },
        [follow, queryClient, viewerId],
    );

    const handleOpenProfile = useCallback(
        (targetUserId: string) => {
            router.push({ pathname: '/u/[identifier]', params: { identifier: targetUserId } });
        },
        [router],
    );

    const handleInvite = useCallback(() => {
        track('invite_sent', { surface: 'feed_empty_state' });
        void Share.share({
            message: TESTFLIGHT_INVITE_URL
                ? `come try Napkin with me — ${TESTFLIGHT_INVITE_URL}`
                : 'come try Napkin with me',
        });
        // Canceling the sheet resolves with dismissedAction — ignored, no toast.
    }, []);

    // ── Tier 1 — follow cards ────────────────────────────────────────────────
    if (resolution.tier === 1) {
        const visible = resolution.cards.filter((c) => !removedIds.has(c.user_id));
        // Following all shown candidates collapses the block; feed.tsx then shows
        // its normal loading/filled state (the in-flight friends-feed refetch) —
        // no dead empty slab mid-transition.
        if (visible.length === 0) return null;

        return (
            <View>
                <View style={styles.wrap}>
                    <View style={[styles.slab, { backgroundColor: palette.surfaceJournalLow }]}>
                        <Text style={[styles.kicker, { color: palette.primary }]}>people you&rsquo;ve eaten with</Text>
                        <View style={styles.cardList}>
                            {visible.map((candidate) => (
                                <CoDinerFollowCard
                                    key={candidate.user_id}
                                    candidate={candidate}
                                    followed={followedIds.has(candidate.user_id)}
                                    onFollow={() => handleFollow(candidate.user_id)}
                                    onOpenProfile={() => handleOpenProfile(candidate.user_id)}
                                />
                            ))}
                        </View>
                    </View>
                </View>
                {/* Discovery holds the tail — the page never dies while the graph is thin */}
                <View style={styles.ledgerGap}>
                    <DiscoveryLedger />
                </View>
            </View>
        );
    }

    // ── Tier 2 — ghost card (ghost line + invite pill in ONE card) ────────────
    return (
        <View>
            <View style={styles.wrap}>
                {/* One quiet card: monogram + muted italic em-dash line, with the
                    invite pill living INSIDE the same surface, indented to align
                    under the text. Reads as "waiting", never "broken" or "real". */}
                <View
                    style={[
                        styles.ghostCard,
                        { backgroundColor: palette.surfaceNote, borderColor: palette.dividerSoft },
                    ]}
                    accessibilityLabel="Your friends' meals will land here"
                >
                    <View style={styles.ghostRow}>
                        <View style={[styles.monogram, { borderColor: palette.dividerSoft }]}>
                            <Text style={[styles.monogramMark, { color: palette.textMuted }]}>·</Text>
                        </View>
                        <Text style={[styles.ghostLine, { color: palette.textMuted }]}>
                            — your friends&rsquo; meals land here
                        </Text>
                    </View>

                    {/* Exactly one CTA — invite. Native share sheet, no in-app modal. */}
                    <Pressable
                        onPress={handleInvite}
                        style={({ pressed }) => [
                            styles.inviteBtn,
                            { borderColor: palette.terracottaBorderStrong, opacity: pressed ? 0.7 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Invite a friend to Napkin"
                    >
                        <Text style={[styles.inviteText, { color: palette.primary }]}>invite a friend</Text>
                    </Pressable>
                </View>
            </View>
            {/* "Worth a look" becomes the page body when there's no feed above it */}
            <View style={styles.ledgerGap}>
                <DiscoveryLedger />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: Spacing.lg,
        marginTop: Spacing.md,
    },
    // Tier 1 slab
    slab: {
        borderRadius: Radius.xl,
        padding: 20,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
    },
    cardList: {
        marginTop: 10,
    },
    // Discovery ledger holds the tail of both tiers (its own horizontal padding)
    ledgerGap: {
        marginTop: 30,
    },
    // Tier 2 ghost card — ghost line + invite pill share ONE surfaceNote card
    ghostCard: {
        borderRadius: Radius.xl,
        borderWidth: 1,
        padding: 18,
    },
    ghostRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
    },
    monogram: {
        width: 44,
        height: 44,
        borderRadius: Radius.full,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    monogramMark: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 26,
    },
    ghostLine: {
        flex: 1,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 16,
        lineHeight: 22,
    },
    inviteBtn: {
        alignSelf: 'flex-start',
        borderWidth: 1.5,
        borderRadius: Radius.full,
        paddingHorizontal: 16,
        paddingVertical: 7,
        marginTop: 14,
        marginLeft: 58,
    },
    inviteText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
    },
});
