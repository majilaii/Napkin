/**
 * /settings/blocked — the caller's blocked users (TICKET-090, guideline 1.2).
 *
 * Plain ledger: avatar + name + "unblock". Blocking happens on profiles and
 * reviews; this is the one place to undo it.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { Avatar } from '@/components/feed/Avatar';
import { useBlockedUsers, useUnblockUser, type BlockedUserRow } from '@/hooks/account';

export default function BlockedUsersScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();

    const { data: rows, isLoading } = useBlockedUsers();
    const unblock = useUnblockUser();

    const renderRow = ({ item }: { item: BlockedUserRow }) => (
        <View style={styles.row}>
            <Avatar name={item.display_name ?? '?'} url={item.avatar_url} size={34} palette={palette} />
            <View style={styles.rowText}>
                <Text style={[styles.rowName, { color: palette.text }]} numberOfLines={1}>
                    {item.display_name ?? 'Someone'}
                </Text>
                {item.username ? (
                    <Text style={[styles.rowMeta, { color: palette.textMuted }]} numberOfLines={1}>
                        @{item.username}
                    </Text>
                ) : null}
            </View>
            <Pressable
                onPress={() => unblock.mutate(item.user_id)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Unblock ${item.display_name ?? 'user'}`}
                style={[styles.unblockPill, { borderColor: 'rgba(160,63,40,0.35)' }]}
            >
                <Text style={[styles.unblockLabel, { color: palette.primary }]}>unblock</Text>
            </Pressable>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top + Spacing.sm }]}>
            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12}>
                    <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
                </Pressable>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                <Text style={[Type.displaySmall, { color: palette.text }]}>Blocked</Text>

                {isLoading ? (
                    <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                ) : (rows ?? []).length === 0 ? (
                    <Text style={[styles.empty, { color: palette.textMuted }]}>
                        No one — blocked people show up here.
                    </Text>
                ) : (
                    <FlatList
                        data={rows}
                        keyExtractor={(item) => item.user_id}
                        renderItem={renderRow}
                        contentContainerStyle={{ paddingTop: Spacing.md, paddingBottom: insets.bottom + Spacing.xl }}
                        showsVerticalScrollIndicator={false}
                    />
                )}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    content: {
        flex: 1,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
    },
    empty: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        marginTop: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
    },
    rowText: {
        flex: 1,
        minWidth: 0,
    },
    rowName: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 15,
    },
    rowMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 1,
    },
    unblockPill: {
        borderWidth: 1.5,
        borderRadius: 999,
        paddingHorizontal: 14,
        paddingVertical: 6,
    },
    unblockLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        textTransform: 'lowercase',
    },
});
