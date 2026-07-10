/**
 * /follows — Instagram-style followers / following list.
 *
 * Route params:
 *   userId: target user's UUID (required)
 *   kind:   'followers' | 'following' (required)
 *
 * Each row → avatar + display name + @username + follow button.
 * Tapping a row → /u/[user_id] for that person's profile.
 */
import React from 'react';
import {
    ActivityIndicator,
    FlatList,
    Pressable,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useFollowList, type FollowListKind, type FollowListRow } from '@/hooks/users/useFollowList';
import { FollowButton } from '@/components/profile/FollowButton';

function initials(displayName: string): string {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return displayName.slice(0, 1).toUpperCase();
}

function PersonRow({ row, isSelf }: { row: FollowListRow; isSelf: boolean }) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    const onPress = () =>
        router.push({ pathname: '/u/[identifier]', params: { identifier: row.user_id } });

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                rowStyles.container,
                { borderBottomColor: palette.dividerSoft, opacity: pressed ? 0.7 : 1 },
            ]}
        >
            <View style={[rowStyles.avatar, { backgroundColor: palette.primaryContainer }]}>
                {row.avatar_url ? (
                    <Image
                        source={{ uri: row.avatar_url }}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                    />
                ) : (
                    <Text style={rowStyles.avatarInitials}>{initials(row.display_name)}</Text>
                )}
            </View>

            <View style={rowStyles.content}>
                <Text
                    style={[rowStyles.displayName, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {row.display_name}
                </Text>
                {row.username ? (
                    <Text
                        style={[rowStyles.handle, { color: palette.textMuted }]}
                        numberOfLines={1}
                    >
                        @{row.username}
                    </Text>
                ) : null}
            </View>

            {!isSelf && (
                <FollowButton
                    targetUserId={row.user_id}
                    initialIsFollowing={row.is_following}
                />
            )}
        </Pressable>
    );
}

export default function FollowsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { userId, kind } = useLocalSearchParams<{ userId?: string; kind?: FollowListKind }>();
    const resolvedKind: FollowListKind = kind === 'followers' ? 'followers' : 'following';

    const { data: rows, isLoading, error } = useFollowList(userId ?? null, resolvedKind);

    const title = resolvedKind === 'followers' ? 'Followers' : 'Following';
    const emptyCopy =
        resolvedKind === 'followers'
            ? 'No followers yet.'
            : 'Not following anyone yet.';

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Header */}
                <View
                    style={[
                        styles.header,
                        { paddingTop: insets.top + Spacing.sm, borderBottomColor: palette.dividerSoft },
                    ]}
                >
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[styles.back, { color: palette.textMuted }]}>{'‹'}</Text>
                    </Pressable>
                    <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
                    <View style={{ width: 24 }} />
                </View>

                {/* Loading */}
                {isLoading && (
                    <View style={styles.center}>
                        <ActivityIndicator color={palette.primary} />
                    </View>
                )}

                {/* Error */}
                {!isLoading && error && (
                    <View style={styles.center}>
                        <Text style={[Type.body, { color: palette.textSecondary, textAlign: 'center' }]}>
                            {"This list isn\u2019t available."}
                        </Text>
                    </View>
                )}

                {/* Empty */}
                {!isLoading && !error && (!rows || rows.length === 0) && (
                    <View style={styles.center}>
                        <Text
                            style={[
                                Type.headlineItalic,
                                {
                                    color: palette.textMuted,
                                    textAlign: 'center',
                                    paddingHorizontal: Spacing.xl,
                                    fontFamily: 'Newsreader_400Regular_Italic',
                                },
                            ]}
                        >
                            {emptyCopy}
                        </Text>
                    </View>
                )}

                {/* List */}
                {!isLoading && rows && rows.length > 0 && (
                    <FlatList
                        data={rows}
                        keyExtractor={(item) => item.user_id}
                        renderItem={({ item }) => (
                            <PersonRow row={item} isSelf={item.user_id === user?.id} />
                        )}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                        showsVerticalScrollIndicator={false}
                    />
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
        borderBottomWidth: 1,
    },
    back: {
        fontSize: 24,
        lineHeight: 28,
    },
    title: {
        ...Type.screenTitle,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
});

const rowStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: Spacing.lg,
        paddingVertical: 12,
        borderBottomWidth: 1,
        gap: 14,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
    },
    avatarInitials: {
        fontFamily: 'Newsreader_400Regular_Italic',
        color: 'rgba(255,255,255,0.92)',
        fontSize: 15,
        letterSpacing: 0.3,
    },
    content: {
        flex: 1,
        minWidth: 0,
    },
    displayName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
        lineHeight: 19,
    },
    handle: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        marginTop: 2,
        letterSpacing: 0.2,
    },
});
