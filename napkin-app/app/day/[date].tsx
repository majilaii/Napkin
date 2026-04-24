/**
 * Day page — Concept C "The Day Logger".
 *
 * Route: /day/[date] where date is YYYY-MM-DD or "today".
 * "today" normalises to the canonical date and router.replace()s.
 *
 * Shows breakfast/lunch/dinner slots. Filled slots → entry-detail.
 * Empty slots → create-entry with visitedAt prefilled.
 * Swipe/arrow nav, capped at 30 days back.
 *
 * Spec says: this replaces the direct `/create-entry` from `+` nav.
 */
import React, { useEffect } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { getTodayDateStr, localDateStr, defaultTimeForSlot } from '@/lib/mealSlots';
import type { MealSlot, SlotEntry } from '@/lib/mealSlots';
import { DayMasthead, MealSlotRow, DayNav } from '@/components/day';
import { useEntriesForDay } from '@/hooks/entries/useEntriesForDay';

const MEAL_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const MAX_DAYS_BACK = 30;

function offsetDate(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + days);
    return localDateStr(date);
}

function daysDiff(fromStr: string, toStr: string): number {
    const [ay, am, ad] = fromStr.split('-').map(Number);
    const [by, bm, bd] = toStr.split('-').map(Number);
    const da = new Date(ay, am - 1, ad).getTime();
    const db = new Date(by, bm - 1, bd).getTime();
    return Math.round((db - da) / (1000 * 60 * 60 * 24));
}

export default function DayPage() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { date: rawDate } = useLocalSearchParams<{ date: string }>();

    // Normalise "today" to canonical YYYY-MM-DD, then replace so the URL stays canonical
    const today = getTodayDateStr();
    const dateStr = !rawDate || rawDate === 'today' ? today : rawDate;

    useEffect(() => {
        if (!rawDate || rawDate === 'today') {
            router.replace(`/day/${today}`);
        }
    }, [rawDate, today]); // eslint-disable-line react-hooks/exhaustive-deps

    const { data: slotMap, isLoading } = useEntriesForDay(user?.id, dateStr);

    const isToday = dateStr === today;
    const daysBack = daysDiff(dateStr, today);
    const atCap = daysBack >= MAX_DAYS_BACK;

    const handleNavigate = (newDate: string) => {
        router.replace(`/day/${newDate}`);
    };

    const handleFillTap = (entry: SlotEntry) => {
        router.push({ pathname: '/entry-detail', params: { entryId: entry.entryId } });
    };

    const handleEmptyTap = (slot: MealSlot) => {
        const visitedAt = defaultTimeForSlot(slot, dateStr);
        router.push({
            pathname: '/create-entry',
            params: { visitedAt },
        });
    };

    // Swipe gesture: right → prev day, left → next day
    const swipe = Gesture.Pan()
        .runOnJS(true)
        .onEnd((e) => {
            if (Math.abs(e.translationX) < 60 || Math.abs(e.translationY) > Math.abs(e.translationX)) return;
            if (e.translationX > 0 && !atCap) {
                // Swipe right → go back in time
                handleNavigate(offsetDate(dateStr, -1));
            } else if (e.translationX < 0 && !isToday) {
                // Swipe left → go forward in time
                handleNavigate(offsetDate(dateStr, 1));
            }
        });

    return (
        <>
            <Stack.Screen options={{ headerShown: false }} />
            <GestureDetector gesture={swipe}>
                <View style={{ flex: 1, backgroundColor: palette.background }}>
                    {/* Top bar */}
                    <View style={[styles.topBar, { paddingTop: insets.top }]}>
                        <Pressable onPress={() => router.back()} hitSlop={12}>
                            <Text style={[Type.body, { color: palette.primary }]}>Done</Text>
                        </Pressable>
                        <Text style={[styles.topTitle, { color: palette.textMuted }]}>
                            your week
                        </Text>
                        <View style={{ width: 40 }} />
                    </View>

                    <ScrollView
                        contentContainerStyle={[
                            styles.content,
                            { paddingBottom: insets.bottom + 100 },
                        ]}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Day nav */}
                        <DayNav dateStr={dateStr} onNavigate={handleNavigate} />

                        {/* Day masthead — Q7: quieter "today" alone */}
                        <DayMasthead dateStr={dateStr} />

                        {/* Meal slots */}
                        {isLoading ? (
                            <ActivityIndicator color={palette.primary} style={{ marginTop: Spacing.xl }} />
                        ) : (
                            <View style={styles.slotList}>
                                {MEAL_SLOTS.map((slot) => (
                                    <MealSlotRow
                                        key={slot}
                                        slot={slot}
                                        entry={slotMap?.[slot] ?? null}
                                        onFillTap={handleFillTap}
                                        onEmptyTap={handleEmptyTap}
                                    />
                                ))}
                            </View>
                        )}
                    </ScrollView>
                </View>
            </GestureDetector>
        </>
    );
}

const styles = StyleSheet.create({
    topBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
        paddingBottom: Spacing.md,
    },
    topTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 15,
    },
    content: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
    },
    slotList: {
        gap: Spacing.sm + 2,
        marginTop: Spacing.sm,
    },
});
