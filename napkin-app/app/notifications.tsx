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
import React, { useMemo } from 'react';
import {
    ActivityIndicator,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import {
    useNotifications,
    bucketFor,
    bucketLabel,
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

    const { data, isLoading } = useNotifications(user?.id);

    const grouped = useMemo(() => {
        const map: Record<NotifBucket, Notification[]> = {
            today: [],
            yesterday: [],
            thisWeek: [],
            earlier: [],
        };
        const all = data?.notifications ?? [];
        for (const n of all) {
            map[bucketFor(n.createdAt)].push(n);
        }
        return map;
    }, [data]);

    const total = data?.notifications.length ?? 0;
    const hasUnread = (data?.unreadCount ?? 0) > 0;

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
                            <Pressable hitSlop={8}>
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
                                            onPress={() => handleTap(n, router)}
                                        />
                                    ))}
                                </View>
                            );
                        })}
                        <Text style={[styles.terminus, { color: palette.textMuted }]}>
                            — older —
                        </Text>
                    </ScrollView>
                )}
            </View>
        </>
    );
}

function handleTap(n: Notification, router: ReturnType<typeof useRouter>) {
    switch (n.type) {
        case 'friend_logged':
            // Land on the friend's log card. We don't have an entry id in the v1
            // sample, so route to their profile as the closest meaningful target.
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
            // No deep link target yet; leave a no-op.
            return;
        case 'claim_city':
            // Future: open the regional Top 4 claim flow.
            return;
        case 'reservation_reminder':
            router.push('/create-entry');
            return;
    }
}

function NotificationRow({
    notification: n,
    onPress,
}: {
    notification: Notification;
    onPress: () => void;
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
        case 'table_invite':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifAvatar name={n.actor.name} src={n.actor.avatarUrl} />}
                    title={
                        <>
                            <I>{firstName(n.actor.name)}</I>
                            {' added you to a new Table — '}
                            <I>{n.tableName}</I>
                            {'.'}
                        </>
                    }
                    time={n.timeLabel}
                    trailing={<NotifAction label="Join" variant="filledPrimary" />}
                />
            );
        case 'claim_city':
            return (
                <NotifRow
                    tone={tone}
                    onPress={onPress}
                    leading={<NotifGlyph tone="amber">{n.logCount}</NotifGlyph>}
                    title={
                        <>
                            {`You’ve logged ${n.logCount} places in `}
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
                    body={"One tap. Or dismiss and we’ll never ask again."}
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
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        fontStyle: 'italic',
        fontWeight: '500',
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
    terminus: {
        textAlign: 'center',
        paddingTop: 22,
        paddingBottom: 8,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 11,
    },
});
