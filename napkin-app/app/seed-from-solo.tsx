/**
 * Seed from Solo — step 2 of the Gather flow. Canvas WF2.
 *
 * Pulls a user's existing solo entries into a new table's founding
 * canon, grouped by three tiers:
 *   1. Auto-matched  — entries tagged with only the other founder
 *   2. Also with others — tagged founder + anyone outside the table
 *   3. Solo at our places — entries at restaurants we've been to together
 *
 * Companion-tagging isn't in the schema yet, so we approximate tier 1
 * as "your solo entries you want to carry over" and tier 3 as "all
 * other solo entries, collapsed". The three-tier skeleton is preserved
 * so the backend can be dropped in later without rebuilding the UI.
 */

import React, { useMemo, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import { useTableActivity, type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { Avatar } from '@/components/feed/Avatar';

export default function SeedFromSoloScreen() {
    const { tableName = 'Your table', partner = '' } = useLocalSearchParams<{
        tableName: string;
        partner: string;
    }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    // Personal table ID = source of solo entries
    const { data: tables } = useTables(user?.id);
    const personalTable = tables?.find((t) => t.tables?.is_personal)?.tables;
    const { data: activityData, isLoading } = useTableActivity(personalTable?.id);
    const items = useMemo(
        () => (activityData?.pages?.flat() ?? []) as SoloShareActivity[],
        [activityData],
    );
    const solos = items.filter((i) => i.type === 'solo_share') as SoloShareActivity[];

    // Buckets — heuristic since companion-tagging isn't in schema
    const autoMatched = solos.slice(0, Math.min(3, solos.length));
    const partialMatched = solos.slice(3, Math.min(5, solos.length));
    const restCount = Math.max(0, solos.length - 5);

    const [selected, setSelected] = useState<Set<string>>(
        () => new Set(autoMatched.map((s) => s.id)),
    );
    const toggle = (id: string) =>
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <View
            style={[
                styles.container,
                { backgroundColor: palette.surfaceJournalLow },
            ]}
        >
            <View
                style={[
                    styles.topBar,
                    { paddingTop: insets.top + 8 },
                ]}
            >
                <Pressable
                    hitSlop={10}
                    onPress={() => router.back()}
                    accessibilityLabel="Back"
                >
                    <Ionicons
                        name="chevron-back"
                        size={22}
                        color={palette.textMuted}
                    />
                </Pressable>
                <Text style={[styles.step, { color: palette.textMuted }]}>
                    STEP 2 OF 3 {'\u00B7'} SEED
                </Text>
                <View style={{ width: 22 }} />
            </View>

            <View style={styles.header}>
                <Text style={[styles.kicker, { color: palette.primary }]}>
                    {tableName}
                    {partner ? `  \u00B7  with ${partner}` : ''}
                </Text>
                <Text style={[styles.headline, { color: palette.text }]}>
                    Some meals <Text style={styles.italic}>were already yours together</Text>.
                </Text>
                <Text style={[styles.sub, { color: palette.textSecondary }]}>
                    We found entries from your solo journal. Pull them into the
                    table&apos;s founding canon.
                </Text>
            </View>

            {isLoading ? (
                <View style={styles.loading}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={{ paddingBottom: 8 }}>
                    {/* Tier 1 */}
                    {autoMatched.length > 0 ? (
                        <>
                            <TierHeader
                                palette={palette}
                                tone="terracotta"
                                label={`Auto-matched \u00B7 ${autoMatched.length}`}
                                sub={
                                    partner
                                        ? `Only ${partner} was tagged`
                                        : 'Meals we think you already share'
                                }
                                right={
                                    selected.size === autoMatched.length
                                        ? 'All selected'
                                        : undefined
                                }
                            />
                            {autoMatched.map((s) => (
                                <SeedRow
                                    key={s.id}
                                    palette={palette}
                                    solo={s}
                                    checked={selected.has(s.id)}
                                    onToggle={() => toggle(s.id)}
                                    tone="terracotta"
                                />
                            ))}

                            <View
                                style={[
                                    styles.note,
                                    {
                                        backgroundColor: palette.surfaceNote,
                                        borderColor: palette.secondary,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.noteKicker,
                                        { color: palette.secondary },
                                    ]}
                                >
                                    A NOTE{' '}
                                </Text>
                                <Text
                                    style={[
                                        styles.noteBody,
                                        { color: palette.textSecondary },
                                    ]}
                                >
                                    If {partner || 'a member'} logged the same meal, on
                                    founding it becomes a{' '}
                                    <Text style={{ fontFamily: 'Manrope_600SemiBold' }}>
                                        round with two voices
                                    </Text>
                                    .
                                </Text>
                            </View>
                        </>
                    ) : null}

                    {/* Tier 2 */}
                    {partialMatched.length > 0 ? (
                        <>
                            <TierHeader
                                palette={palette}
                                tone="secondary"
                                label={`Also with others \u00B7 ${partialMatched.length}`}
                                sub={
                                    partner
                                        ? `Tagged ${partner} and someone outside the table`
                                        : 'Tagged with mixed company'
                                }
                            />
                            {partialMatched.map((s) => (
                                <SeedRow
                                    key={s.id}
                                    palette={palette}
                                    solo={s}
                                    checked={selected.has(s.id)}
                                    onToggle={() => toggle(s.id)}
                                    tone="secondary"
                                />
                            ))}
                        </>
                    ) : null}

                    {/* Tier 3 */}
                    {restCount > 0 ? (
                        <TierHeader
                            palette={palette}
                            tone="muted"
                            label={`Solo at our places \u00B7 ${restCount}`}
                            sub="Collapsed — tap to browse"
                        />
                    ) : null}
                </ScrollView>
            )}

            <View
                style={[
                    styles.cta,
                    {
                        backgroundColor: palette.surfaceJournalLow,
                        paddingBottom: insets.bottom + 20,
                    },
                ]}
            >
                <Text
                    style={[styles.ctaCount, { color: palette.textSecondary }]}
                >
                    <Text style={{ fontFamily: 'Manrope_700Bold' }}>
                        {selected.size} entries
                    </Text>
                    {' seeded'}
                </Text>
                <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => [
                        styles.ctaBtn,
                        {
                            backgroundColor: palette.primary,
                            opacity: pressed ? 0.88 : 1,
                        },
                    ]}
                >
                    <Text
                        style={[styles.ctaBtnText, { color: palette.background }]}
                    >
                        PULL UP A CHAIR {'\u00B7'} CONTINUE
                    </Text>
                </Pressable>
            </View>
        </View>
    );
}

function TierHeader({
    palette,
    tone,
    label,
    sub,
    right,
}: {
    palette: typeof Colors.light;
    tone: 'terracotta' | 'secondary' | 'muted';
    label: string;
    sub?: string;
    right?: string;
}) {
    const color =
        tone === 'terracotta'
            ? palette.primary
            : tone === 'secondary'
            ? palette.textSecondary
            : palette.textMuted;
    return (
        <View style={styles.tierHeader}>
            <View style={{ flex: 1 }}>
                <Text
                    style={[styles.tierLabel, { color }]}
                >
                    {label.toUpperCase()}
                </Text>
                {sub ? (
                    <Text
                        style={[styles.tierSub, { color: palette.textMuted }]}
                    >
                        {sub}
                    </Text>
                ) : null}
            </View>
            {right ? (
                <Text style={[styles.tierRight, { color: palette.primary }]}>
                    {right}
                </Text>
            ) : null}
        </View>
    );
}

function SeedRow({
    palette,
    solo,
    checked,
    onToggle,
    tone,
}: {
    palette: typeof Colors.light;
    solo: SoloShareActivity;
    checked: boolean;
    onToggle: () => void;
    tone: 'terracotta' | 'secondary';
}) {
    const bg = checked
        ? tone === 'terracotta'
            ? palette.primary
            : palette.secondary
        : 'transparent';
    const d = new Date(solo.visited_at ?? solo.created_at);
    const when = d.toLocaleDateString('en-GB', {
        weekday: 'short',
        day: '2-digit',
        month: 'short',
    });
    return (
        <Pressable onPress={onToggle} style={styles.seedRow}>
            <View
                style={[
                    styles.seedCheck,
                    {
                        backgroundColor: bg,
                        borderColor: checked ? bg : palette.ruleInkSoft,
                    },
                ]}
            >
                {checked ? (
                    <Ionicons
                        name="checkmark"
                        size={12}
                        color={palette.background}
                    />
                ) : null}
            </View>
            <Avatar
                name={solo.profiles?.display_name ?? 'You'}
                url={null}
                size={20}
                palette={palette}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text
                    style={[styles.seedName, { color: palette.text }]}
                    numberOfLines={1}
                >
                    {solo.restaurants?.name ?? 'Unknown'}
                </Text>
                <Text
                    style={[styles.seedSub, { color: palette.textMuted }]}
                    numberOfLines={1}
                >
                    {when}
                </Text>
            </View>
            {solo.rating != null ? (
                <Text style={[styles.seedRating, { color: palette.tertiary }]}>
                    {solo.rating.toFixed(1)}
                </Text>
            ) : null}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    topBar: {
        paddingHorizontal: 22,
        paddingBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    step: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.8,
    },
    header: {
        paddingHorizontal: 24,
        paddingTop: 16,
        paddingBottom: 14,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    headline: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 24,
        lineHeight: 29,
        letterSpacing: -0.4,
        marginBottom: 6,
    },
    italic: {
        fontFamily: 'Newsreader_400Regular_Italic',
    },
    sub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        lineHeight: 18,
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    tierHeader: {
        paddingHorizontal: 22,
        paddingTop: 12,
        paddingBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    tierLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 0.8,
    },
    tierSub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        marginTop: 2,
    },
    tierRight: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 10,
        letterSpacing: 0.3,
    },
    seedRow: {
        paddingHorizontal: 22,
        paddingVertical: 10,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    seedCheck: {
        width: 20,
        height: 20,
        borderRadius: 4,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    seedName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    seedSub: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        marginTop: 2,
    },
    seedRating: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
    },
    note: {
        marginHorizontal: 22,
        marginVertical: 10,
        padding: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: 'dashed',
    },
    noteKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 0.8,
    },
    noteBody: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        lineHeight: 17,
    },
    cta: {
        paddingHorizontal: 22,
        paddingTop: 12,
    },
    ctaCount: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
        textAlign: 'center',
        marginBottom: 10,
    },
    ctaBtn: {
        paddingVertical: 14,
        borderRadius: 999,
        alignItems: 'center',
    },
    ctaBtnText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.8,
    },
});
