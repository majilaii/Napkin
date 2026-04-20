/**
 * Regulars full-screen — Artboard 5.
 * TICKET-025
 *
 * Ranked list (≥3 visits), ×N visit count in terracotta.
 * Takes optional ?userId param; defaults to self.
 * Route: /regulars or /regulars?userId=<uuid>
 */
import React from 'react';
import {
    ActivityIndicator,
    FlatList,
    StyleSheet,
    Text,
    View,
    Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserRegulars } from '@/hooks/users/useUserRegulars';
import { RegularRow } from '@/components/profile/RegularRow';

export default function RegularsScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { userId } = useLocalSearchParams<{ userId?: string }>();
    const targetId = userId ?? user?.id ?? null;

    const { data: regulars, isLoading, error } = useUserRegulars(targetId);

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <View style={[styles.container, { backgroundColor: palette.background }]}>
                {/* Header */}
                <View style={[styles.header, { paddingTop: insets.top + Spacing.sm, borderBottomColor: palette.dividerSoft }]}>
                    <Pressable onPress={() => router.back()} hitSlop={12}>
                        <Text style={[styles.back, { color: palette.textMuted }]}>{'‹'}</Text>
                    </Pressable>
                    <Text style={[styles.title, { color: palette.text }]}>Your regulars</Text>
                    <View style={{ width: 24 }} />
                </View>

                {/* Subtitle band */}
                <View style={styles.subtitleBand}>
                    <Text
                        style={[
                            Type.headlineItalic,
                            { fontSize: 13, color: palette.textMuted, fontFamily: 'Newsreader_400Regular_Italic', lineHeight: 20 },
                        ]}
                    >
                        {"Places you\u2019ve logged three or more times. The ones that stuck."}
                    </Text>
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
                            {"Couldn\u2019t load regulars"}
                        </Text>
                    </View>
                )}

                {/* Empty */}
                {!isLoading && !error && (!regulars || regulars.length === 0) && (
                    <View style={styles.center}>
                        <Text
                            style={[
                                Type.headlineItalic,
                                { color: palette.textMuted, textAlign: 'center', paddingHorizontal: Spacing.xl },
                            ]}
                        >
                            No regulars yet — log a place three times and it earns a spot here.
                        </Text>
                    </View>
                )}

                {/* List */}
                {!isLoading && regulars && regulars.length > 0 && (
                    <FlatList
                        data={regulars}
                        keyExtractor={(item) => item.restaurant_id}
                        renderItem={({ item }) => <RegularRow regular={item} />}
                        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                        showsVerticalScrollIndicator={false}
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
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 18,
        fontWeight: '500',
    },
    subtitleBand: {
        paddingHorizontal: Spacing.lg,
        paddingVertical: 10,
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: Spacing.xl,
    },
});
