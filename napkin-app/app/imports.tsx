/**
 * /imports — full import history.
 *
 * Every import batch (a video / link / screenshot that dropped N spots into the
 * wishlist), newest first. Tap a batch → its detail screen to review / prune.
 */
import React from 'react';
import { View, Text, FlatList, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useImportHistory } from '@/hooks/wishlist/useImportHistory';
import {
    importSourceLabel,
    spotCountLabel,
    previewLine,
    relativeTime,
} from '@/components/wishlist/importSourceLabel';

export default function ImportsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: batches = [], isLoading } = useImportHistory(user?.id, 50);

    return (
        <View style={[styles.container, { backgroundColor: palette.background }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
                <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                </Pressable>
                <Text style={[styles.title, { color: palette.text }]}>imports</Text>
                <View style={{ width: 20 }} />
            </View>

            {isLoading ? (
                <View style={styles.center}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : batches.length === 0 ? (
                <View style={styles.center}>
                    <Text style={[styles.emptyText, { color: palette.textMuted }]}>— no imports yet</Text>
                    <Text style={[styles.emptyHint, { color: palette.textMuted }]}>
                        share a video or link to import spots.
                    </Text>
                </View>
            ) : (
                <FlatList
                    data={batches}
                    keyExtractor={(b) => b.job_id}
                    contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.xxl }]}
                    ItemSeparatorComponent={() => <View style={{ height: Spacing.sm }} />}
                    renderItem={({ item: b }) => (
                        <Pressable
                            onPress={() => router.push(`/imports/${b.job_id}` as any)}
                            style={({ pressed }) => [
                                styles.card,
                                { backgroundColor: palette.card, opacity: pressed ? 0.85 : 1 },
                                Shadow.subtle,
                            ]}
                        >
                            <View style={{ flex: 1, gap: 3 }}>
                                <Text style={[styles.cardTitle, { color: palette.text }]} numberOfLines={1}>
                                    {previewLine(b.preview_names, b.item_count)}
                                </Text>
                                <Text style={[styles.cardMeta, { color: palette.textMuted }]} numberOfLines={1}>
                                    {`${importSourceLabel(b.source)} · ${spotCountLabel(b.item_count)} · ${relativeTime(b.created_at)}`}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
                        </Pressable>
                    )}
                />
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 22,
        paddingBottom: Spacing.md,
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 24,
        lineHeight: 28,
    },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.xl, gap: 8 },
    emptyText: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 20, lineHeight: 26 },
    emptyHint: { fontFamily: 'Manrope_500Medium', fontSize: 13, textAlign: 'center' },
    listContent: { paddingHorizontal: 22, paddingTop: Spacing.sm },
    card: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        borderRadius: Radius.md,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.md,
    },
    cardTitle: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17, lineHeight: 21 },
    cardMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
});
