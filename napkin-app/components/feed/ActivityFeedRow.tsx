/** Pins and personal list updates share the quiet, dated activity ledger. */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import type { PinFeedRow, ListFeedRow } from '@/hooks/feed';

export function ActivityFeedRow({ row, showDivider }: { row: PinFeedRow | ListFeedRow; showDivider: boolean }) {
    const palette = Colors[useColorScheme() ?? 'light'];
    const router = useRouter();
    const { user } = useAuth();
    const actor = row.user_id === user?.id ? 'you' : row.author.display_name;
    const isPin = row.kind === 'pin';
    const title = isPin ? row.restaurant.name : row.title;
    const verb = isPin ? 'pinned' : `${row.action} a list`;
    const open = () => isPin
        ? router.push({ pathname: '/restaurant/[id]', params: { id: row.restaurant_id } })
        : router.push({ pathname: '/list/[id]', params: { id: row.list_id } });
    return <>
        <Pressable onPress={open} accessibilityRole="button" accessibilityLabel={`${actor} ${verb}, ${title}`}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
            <Ionicons name={isPin ? 'bookmark-outline' : 'albums-outline'} size={18} color={palette.textMuted} />
            <View style={styles.content}>
                <Text style={[Type.feedMeta, { color: palette.textMuted }]} numberOfLines={1}>
                    <Text style={[Type.feedMetaStrong, { color: palette.text }]}>{actor}</Text> · {verb}
                </Text>
                <Text style={[Type.feedNoteRestaurant, { color: palette.text }]} numberOfLines={2}>{title}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.textFaint} />
        </Pressable>
        {showDivider ? <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.dividerSoft }} /> : null}
    </>;
}
const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', minHeight: 68, gap: Spacing.md, paddingVertical: Spacing.md },
    content: { flex: 1, gap: Spacing.xs },
});
