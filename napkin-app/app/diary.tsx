/**
 * Diary full-screen — Artboard 4.
 * TICKET-025
 *
 * Month-grouped chronological scroll-back with year summary band.
 * Takes optional ?userId param; defaults to self.
 * Route: /diary or /diary?userId=<uuid>
 */
import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    SectionList,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserDiary, groupDiaryByMonth } from '@/hooks/users/useUserDiary';
import { DiaryRow } from '@/components/profile/DiaryRow';
import type { DiaryEntryRow } from '@/hooks/users/useUserProfile';

export default function DiaryScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { userId } = useLocalSearchParams<{ userId?: string }>();
    const targetId = userId ?? user?.id ?? null;

    const {
        data,
        isLoading,
        error,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useUserDiary(targetId);

    const allRows: DiaryEntryRow[] = data?.pages.flatMap((p) => p.rows) ?? [];
    const monthGroups = groupDiaryByMonth(allRows);

    const sections = monthGroups.map((g) => ({
        title: g.monthLabel,
        data: g.rows,
    }));

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm, borderBottomColor: palette.dividerSoft }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[styles.back, { color: palette.textMuted }]}>{'‹'}</Text>
                    </Pressable>
                    <Text style={[styles.title, { color: palette.text }]}>Diary</Text>
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
                            {"Couldn\u2019t load diary"}
                        </Text>
                    </View>
                )}

                {/* Empty */}
                {!isLoading && !error && allRows.length === 0 && (
                    <View style={styles.center}>
                        <Text
                            style={[
                                Type.headlineItalic,
                                { color: palette.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
                            ]}
                        >
                            Nothing logged yet.
                        </Text>
                    </View>
                )}

                {/* SectionList */}
                {!isLoading && allRows.length > 0 && (
                    <SectionList
                        sections={sections}
                        keyExtractor={(item) => item.entry_id}
                        renderItem={({ item }) => <DiaryRow entry={item} />}
                        renderSectionHeader={({ section: { title } }) => (
                            <View style={[styles.monthHeader, { backgroundColor: palette.background }]}>
                                <Text
                                    style={[
                                        styles.monthLabel,
                                        { color: palette.textMuted, fontFamily: 'Newsreader_400Regular_Italic' },
                                    ]}
                                >
                                    {title}
                                </Text>
                            </View>
                        )}
                        onEndReached={() => {
                            if (hasNextPage && !isFetchingNextPage) {
                                fetchNextPage();
                            }
                        }}
                        onEndReachedThreshold={0.4}
                        ListFooterComponent={
                            isFetchingNextPage ? (
                                <View style={{ padding: Spacing.lg }}>
                                    <ActivityIndicator color={palette.primary} />
                                </View>
                            ) : null
                        }
                        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                        showsVerticalScrollIndicator={false}
                        stickySectionHeadersEnabled={true}
                    />
                )}
            </View>
        </>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
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
    monthHeader: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
        paddingBottom: Spacing.sm,
    },
    monthLabel: {
        fontSize: 14,
        fontStyle: 'italic',
        letterSpacing: 0.3,
        textTransform: 'uppercase',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
});
