/**
 * /notifications — Heirloom inbox.
 *
 * Voice rules (notifications-canvas.jsx post-it):
 *   Past tense, subject first. Italic-serif for proper nouns
 *   (restaurants, Tables, cities). No emoji, no "reacted to your post."
 *   Time on its own line, muted. Prefer "Tuesday evening" over "2h ago"
 *   when we can afford it.
 *
 * Loudness ladder (notifications-canvas.jsx post-it):
 *   Freshness = 2px terracotta spine + 2.5% tint wash.
 *   No blue dots, no "NEW" badges. Rhythm: Today / Yesterday / This week / Earlier.
 */
import React, { useMemo, useCallback, useRef, useEffect } from 'react';
import {
    ActivityIndicator,
    NativeScrollEvent,
    NativeSyntheticEvent,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    useNotifications,
    useUnreadCount,
    useMarkNotificationRead,
    useMarkAllNotificationsRead,
    useRespondInvitation,
    bucketFor,
    bucketLabel,
    flattenPages,
    type Notification,
    type NotifBucket,
} from '@/hooks/notifications';
import {
    NotifRow,
    NotifDay,
    NotifEmpty,
    NotifAvatar,
    NotifThumb,
    NotifGlyph,
    NotifAction,
    I,
} from '@/components/notifications';

const BUCKET_ORDER: NotifBucket[] = ['today', 'yesterday', 'thisWeek', 'earlier'];

export default function NotificationsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const {
        data,
        isLoading,
        isFetchingNextPage,
        fetchNextPage,
        hasNextPage,
        refetch,
    } = useNotifications(user?.id);

    const unreadCount = useUnreadCount(user?.id);
    const hasUnread = unreadCount > 0;

    const markRead = useMarkNotificationRead(user?.id);
    const markAllRead = useMarkAllNotificationsRead(user?.id);
    const respond = useRespondInvitation(user?.id);

    // Guard: don't fire focus refetch while a mark-read mutation is in-flight
    // (would race and overwrite the optimistic patch before the server responds).
    const markPending = markRead.isPending || markAllRead.isPending;

    useFocusEffect(
        useCallback(() => {
            if (!markPending) {
                refetch();
            }
        }, [refetch, markPending]),
    );

    const notifications = flattenPages(data);

    const grouped = useMemo(() => {
        const map: Record<NotifBucket, Notification[]> = {
            today: [],
            yesterday: [],
            thisWeek: [],
            earlier: [],
        };
        for (const n of notifications) {
            map[bucketFor(n.createdAt)].push(n);
        }
        return map;
    }, [notifications]);

    const total = notifications.length;

    // Auto-advance when the first page returns zero VISIBLE rows but more
    // raw rows exist (e.g. all stale `friend_logged` rows filtered out by
    // visibility re-check). Without this, the screen renders NotifEmpty
    // forever — `handleScroll` lives inside the ScrollView, which isn't
    // rendered when `total === 0`. Re-fires whenever a new page lands and
    // still has zero visible rows.
    useEffect(() => {
        if (total === 0 && hasNextPage && !isFetchingNextPage && !isLoading) {
            fetchNextPage();
        }
    }, [total, hasNextPage, isFetchingNextPage, isLoading, fetchNextPage]);

    // Infinite scroll: fetch next page when within 200px of the bottom.
    const handleScroll = useCallback(
        (e: NativeSyntheticEvent<NativeScrollEvent>) => {
            if (isFetchingNextPage || !hasNextPage) return;
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            const distanceFromBottom =
                contentSize.height - (contentOffset.y + layoutMeasurement.height);
            if (distanceFromBottom < 200) {
                fetchNextPage();
            }
        },
        [isFetchingNextPage, hasNextPage, fetchNextPage],
    );

    const handleTapRow = useCallback(
        (n: Notification) => {
            // Optimistically mark this row read before navigating.
            if (!n.read) {
                markRead.mutate(n.id);
            }
            handleTap(n, router);
        },
        [markRead, router],
    );

    // Accept / decline a pending table invitation. Fires markRead (reusing the
    // existing unread-count decrement — no duplication) alongside the respond
    // mutation, which patches the row's status to accepted/declined in place.
    const handleRespond = useCallback(
        (n: Notification, response: 'accept' | 'decline') => {
            if (n.type !== 'table_invite') return;
            if (!n.read) markRead.mutate(n.id);
            respond.mutate({
                invitationId: n.invitationId,
                response,
                tableId: n.tableId,
                notificationId: n.id,
            });
        },
        [markRead, respond],
    );

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View
                style={[
                    styles.container,
                    { backgroundColor: palette.background, paddingTop: insets.top },
                ]}
            >
                {/* Header */}
                <View style={styles.header}>
                    <Pressable
                        onPress={() => router.back()}
                        hitSlop={12}
                        style={styles.headerSide}
                    >
                        <Text style={[styles.back, { color: palette.textMuted }]}>
                            {'‹'}
                        </Text>
                    </Pressable>
                    <Text style={[styles.title, { color: palette.text }]}>
                        Notifications
                    </Text>
                    <View style={[styles.headerSide, { alignItems: 'flex-end' }]}>
                        {hasUnread ? (
                            <Pressable
                                hitSlop={8}
                                onPress={() => markAllRead.mutate()}
                            >
                                <Text style={[styles.action, { color: palette.textMuted }]}>
                                    Mark read
                                </Text>
                            </Pressable>
                        ) : null}
                    </View>
                </View>

                {/* Body */}
                {isLoading ? (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                ) : total === 0 ? (
                    <NotifEmpty />
                ) : (
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        onScroll={handleScroll}
                        scrollEventThrottle={200}
                        contentContainerStyle={{
                            paddingBottom: insets.bottom + 100,
                        }}
                    >
                        {BUCKET_ORDER.map((bucket) => {
                            const items = grouped[bucket];
                            if (items.length === 0) return null;
                            return (
                                <View key={bucket}>
                                    <NotifDay>{bucketLabel(bucket)}</NotifDay>
                                    {items.map((n) => (
                                        <NotificationRow
                                            key={n.id}
                                            notification={n}
                                            onPress={() => handleTapRow(n)}
                                            onRespond={(response) => handleRespond(n, response)}
                                        />
                                    ))}
                                </View>
                            );
                        })}
                        {isFetchingNextPage ? (
                            <View style={styles.loadMore}>
                                <ActivityIndicator size="small" color={palette.primary} />
                            </View>
                        ) : (
                            <Text style={[styles.terminus, { color: palette.textMuted }]}>
                                — older —
                            </Text>
                        )}
                    </ScrollView>
                )}
            </View>
        </>
    );
}

function handleTap(n: Notification, router: ReturnType<typeof useRouter>) {
    switch (n.type) {
        case 'friend_logged':
            // Land on the entry via actor profile (entry-detail route not yet universal).
            router.push({ pathname: '/u/[identifier]', params: { identifier: n.actor.id } });
            return;
        case 'friend_pinned':
            // Tap → shared wishlist with the fresh pin lifted; v1: open the
            // viewer's own wishlist as a stand-in until shared lists land.
            router.push('/wishlist');
            return;
        case 'top_four_swap':
            router.push({ pathname: '/u/[identifier]', params: { identifier: n.actor.id } });
            return;
        case 'table_invite':
            // Tables tab reads `selected` param and focuses the matching table;
            // full /table/[id] deep route deferred until the index screen exists.
            router.push({ pathname: '/(tabs)/tables', params: { selected: n.tableId } });
            return;
        case 'table_invite_accepted':
            // Inviter-side: land on the table the invitee just joined.
            router.push({ pathname: '/(tabs)/tables', params: { selected: n.tableId } });
            return;
        case 'claim_city':
            // Future: open the regional Top 4 claim flow.
            return;
        case 'reservation_reminder':
            router.push('/create-entry');
            return;
        case 'import_done':
            // saved → the batch detail (server job_id); review/failed → the hub.
            // Hierarchical nav is sacred: never deep-link past /import-progress.
            if (n.outcome === 'saved' && n.jobId) {
                router.push({ pathname: '/imports/[jobId]', params: { jobId: n.jobId } });
            } else {
                router.push('/import-progress' as any);
            }
            return;
    }
}

function NotificationRow({
    notification: n,
    onPress,
    onRespond,
}: {
    notification: Notification;
    onPress: () => void;
    /** Accept/decline handler — only used by pending table_invite cards. */
    onRespond?: (response: 'accept' | 'decline') => void;
}) {
    const tone = n.read ? 'read' : 'fresh';

    switch (n.type) {
        case 'friend_logged':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                    title={
                        <>
                            <I>{firstName(n.actor.name)}</I>
                            {' logged '}
                            <I>{n.restaurantName}</I>
                            {'.'}
                        </>
                    }
                    body={n.quote}
                    time={n.timeLabel}
                    trailing={
                        n.photoUrl ? <NotifThumb src={n.photoUrl} /> : undefined
                    }
                />
            );
        case 'friend_pinned':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                    title={
                        <>
                            <I>{firstName(n.actor.name)}</I>
                            {' pinned '}
                            <I>{n.restaurantName}</I>
                            {' to your shared wishlist '}
                            <I>{n.wishlistLabel}</I>
                            {'.'}
                        </>
                    }
                    time={n.timeLabel}
                    trailing={
                        n.photoUrl ? <NotifThumb src={n.photoUrl} /> : undefined
                    }
                />
            );
        case 'top_four_swap':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                    title={
                        <>
                            <I>{firstName(n.actor.name)}</I>
                            {' swapped '}
                            <I>{n.removedName}</I>
                            {' for '}
                            <I>{n.addedName}</I>
                            {' in '}
                            <I>{n.tableName}</I>
                            {'’s Top 4.'}
                        </>
                    }
                    time={n.timeLabel}
                    trailing={
                        n.photoUrl ? (
                            <NotifThumb src={n.photoUrl} size={28} tall={false} />
                        ) : undefined
                    }
                />
            );
        case 'table_invite': {
            // Pending → stateful invite card with Accept/Decline (no deep-link).
            // Resolved → quiet info line. Status is joined LIVE at hydration.
            if (n.invitationStatus === 'pending') {
                const memberMeta = `${n.memberCount} member${n.memberCount === 1 ? '' : 's'}`;
                return (
                    <NotifRow
                        tone={tone}
                        leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                        title={
                            <>
                                <I>{firstName(n.actor.name)}</I>
                                {' invited you to '}
                                <I>{n.tableName}</I>
                            </>
                        }
                        time={`${memberMeta} · ${n.timeLabel}`}
                        trailing={
                            <View style={styles.inviteActions}>
                                <NotifAction
                                    label="Accept"
                                    variant="filledPrimary"
                                    onPress={() => onRespond?.('accept')}
                                />
                                <NotifAction
                                    label="Decline"
                                    variant="outlined"
                                    onPress={() => onRespond?.('decline')}
                                />
                            </View>
                        }
                    />
                );
            }
            if (n.invitationStatus === 'accepted') {
                return (
                    <NotifRow
                        tone={tone}
                        onPress={onPress}
                        leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                        title={
                            <>
                                {'joined '}
                                <I>{n.tableName}</I>
                                {'.'}
                            </>
                        }
                        time={n.timeLabel}
                    />
                );
            }
            if (n.invitationStatus === 'declined') {
                // declined → quiet muted row (always read tone).
                return (
                    <NotifRow
                        tone="read"
                        onPress={onPress}
                        leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                        title={
                            <>
                                {'declined '}
                                <I>{n.tableName}</I>
                                {'.'}
                            </>
                        }
                        time={n.timeLabel}
                    />
                );
            }
            // expired → its own quiet line, same treatment as declined (a future
            // expiry job must not mislabel unanswered invites as "declined").
            return (
                <NotifRow
                    tone="read"
                    onPress={onPress}
                    leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                    title={
                        <>
                            {'invite expired · '}
                            <I>{n.tableName}</I>
                        </>
                    }
                    time={n.timeLabel}
                />
            );
        }
        case 'table_invite_accepted':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                    title={
                        <>
                            <I>{firstName(n.actor.name)}</I>
                            {' joined '}
                            <I>{n.tableName}</I>
                            {'.'}
                        </>
                    }
                    time={n.timeLabel}
                />
            );
        case 'import_done': {
            // Self-directed (null actor) → glyph leading, no avatar. Amber tone
            // matches the other self-directed nudge (claim_city); reuses an
            // accent already on this screen (no new color). Count numeral for
            // saved/review; an attention mark for the count-less failure.
            const spotWord = n.count === 1 ? 'spot' : 'spots';
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={
                        <NotifGlyph tone="amber">
                            {n.outcome === 'failed' ? '!' : n.count}
                        </NotifGlyph>
                    }
                    title={
                        n.outcome === 'saved' ? (
                            <>
                                {`${n.count} ${spotWord} pinned from `}
                                <I>TikTok</I>
                            </>
                        ) : n.outcome === 'review' ? (
                            `${n.count} ${spotWord} ready to review`
                        ) : (
                            'an import needs attention'
                        )
                    }
                    time={n.timeLabel}
                />
            );
        }
        case 'claim_city':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifGlyph tone="amber">{n.logCount}</NotifGlyph>}
                    title={
                        <>
                            {`You've logged ${n.logCount} places in `}
                            <I>{n.cityName}</I>
                            {'. Ready to name a Top 4?'}
                        </>
                    }
                    body={'Only you can see this. Lives here until you claim it.'}
                    time={n.timeLabel}
                    trailing={<NotifAction label="Claim" variant="outlined" />}
                />
            );
        case 'reservation_reminder':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifGlyph tone="olive">{'✎'}</NotifGlyph>}
                    title={
                        <>
                            {'You had a reservation at '}
                            <I>{n.restaurantName}</I>
                            {` ${n.dayLabel}. Care to log it?`}
                        </>
                    }
                    body={"One tap. Or dismiss and we'll never ask again."}
                    time={n.timeLabel}
                    trailing={<NotifAction label="Log" variant="filledInk" />}
                />
            );
    }
}

function firstName(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    return parts[0] ?? displayName;
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingTop: Spacing.xs,
        paddingBottom: 12,
    },
    headerSide: {
        width: 60,
    },
    back: {
        fontSize: 24,
        lineHeight: 28,
    },
    title: {
        ...Type.screenTitle,
        textAlign: 'center',
        flex: 1,
    },
    action: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    center: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    loadMore: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    terminus: {
        textAlign: 'center',
        paddingTop: 22,
        paddingBottom: 8,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 11,
    },
    // Pending invite card: Accept over Decline, stacked so the title keeps width.
    inviteActions: {
        gap: 6,
        alignItems: 'stretch',
    },
});
