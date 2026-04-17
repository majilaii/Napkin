/**
 * PublicListsSection — shows target user's public lists as list rows.
 * Tapping a row routes to /list/[id] (TICKET-018 list detail).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Radius, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { ProfileListSummary } from '@/hooks/users/useUserProfile';

interface Props {
    lists: ProfileListSummary[];
}

export function PublicListsSection({ lists }: Props) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();

    if (lists.length === 0) return null;

    return (
        <View style={styles.section}>
            <Text style={[Type.label, styles.sectionLabel, { color: palette.textSecondary }]}>
                Lists
            </Text>
            <View style={{ gap: Spacing.sm }}>
                {lists.map((list) => (
                    <Pressable
                        key={list.id}
                        onPress={() => router.push({ pathname: '/list/[id]', params: { id: list.id } })}
                        style={({ pressed }) => [
                            styles.row,
                            {
                                backgroundColor: pressed
                                    ? palette.surfaceContainerHigh
                                    : palette.surfaceContainerLow,
                            },
                        ]}
                    >
                        <View style={{ flex: 1 }}>
                            <Text style={[Type.titleSmall, { color: palette.text }]} numberOfLines={1}>
                                {list.title}
                            </Text>
                            <View style={styles.meta}>
                                <Text style={[Type.caption, { color: palette.textMuted }]}>
                                    {list.entry_count} {list.entry_count === 1 ? 'place' : 'places'}
                                </Text>
                                <Text style={[Type.caption, { color: palette.textMuted }]}>·</Text>
                                <Text style={[Type.caption, { color: palette.textMuted }]}>
                                    {list.ranked ? 'Ranked' : 'Unranked'}
                                </Text>
                            </View>
                        </View>
                        <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                    </Pressable>
                ))}
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginTop: Spacing.xl,
    },
    sectionLabel: {
        marginBottom: Spacing.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
        borderRadius: Radius.md,
        gap: Spacing.sm,
    },
    meta: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
        marginTop: 2,
    },
});
