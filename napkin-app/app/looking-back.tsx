/**
 * Looking Back — the annual ceremonial recap for a Table. Canvas WF9.
 *
 * Printed-menu aesthetic, not Spotify Wrapped: centered rules, italic
 * serif hero, a short series of single-fact stat blocks. Tied to the
 * Table's founding anniversary (not calendar year).
 *
 * Route params:
 *   tableId — the table to recap
 *
 * Data: derives what it can from useTableActivity + useTableMembers.
 * Rounds count, home restaurant (most-logged), voices breakdown, and
 * a quote-of-the-year are computed client-side from the feed.
 */

import React, { useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    Pressable,
    ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
    useTableActivity,
    flattenActivity,
    type TableNightActivity,
    type SoloShareActivity,
} from '@/hooks/tables/useTableActivity';
import { useTableMembers } from '@/hooks/tables/useTableMembers';
import { useTables } from '@/hooks/tables/useTables';
import { useAuth } from '@/providers/AuthProvider';
import { Avatar } from '@/components/feed/Avatar';

export default function LookingBackScreen() {
    const { tableId } = useLocalSearchParams<{ tableId: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user } = useAuth();

    const { data: tables } = useTables(user?.id);
    const { data: activityData, isLoading } = useTableActivity(tableId);
    const { data: members } = useTableMembers(tableId);

    const activeTable = tables?.find((t) => t.tables?.id === tableId)?.tables;
    const tableName = activeTable?.name ?? 'Your Table';
    const foundedAt = activeTable?.created_at ?? null;

    const items = useMemo(
        () => flattenActivity(activityData),
        [activityData],
    );

    const stats = useMemo(() => {
        const rounds = items.filter((i) => i.type === 'table_night') as TableNightActivity[];
        const solos = items.filter((i) => i.type === 'solo_share') as SoloShareActivity[];

        // home restaurant — most-returned by round count
        const counts = new Map<string, { name: string; count: number; avgSum: number; avgN: number }>();
        for (const r of rounds) {
            if (!r.restaurants) continue;
            const k = r.restaurants.id;
            const prev = counts.get(k) ?? {
                name: r.restaurants.name,
                count: 0,
                avgSum: 0,
                avgN: 0,
            };
            prev.count += 1;
            if (r.average_rating != null) {
                prev.avgSum += r.average_rating;
                prev.avgN += 1;
            }
            counts.set(k, prev);
        }
        let home: { name: string; count: number; avg: number } | null = null;
        for (const v of counts.values()) {
            if (!home || v.count > home.count) {
                home = {
                    name: v.name,
                    count: v.count,
                    avg: v.avgN ? v.avgSum / v.avgN : 0,
                };
            }
        }

        // quote of the year — highest-rated solo entry with content
        const quoted = solos
            .filter((s) => s.content && s.content.length > 0 && s.rating != null)
            .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];

        // voices — counts per member
        const perMember = new Map<
            string,
            { name: string; logs: number; words: number; photos: number; avgSum: number; avgN: number }
        >();
        for (const s of solos) {
            const name = s.profiles?.display_name ?? '?';
            const k = s.user_id;
            const prev = perMember.get(k) ?? {
                name,
                logs: 0,
                words: 0,
                photos: 0,
                avgSum: 0,
                avgN: 0,
            };
            prev.logs += 1;
            prev.words += (s.content ?? '').split(/\s+/).filter(Boolean).length;
            prev.photos += s.photo_count ?? (s.photo_url ? 1 : 0);
            if (s.rating != null) {
                prev.avgSum += s.rating;
                prev.avgN += 1;
            }
            perMember.set(k, prev);
        }

        const membersList = Array.from(perMember.values()).map((v) => ({
            name: v.name,
            logs: v.logs,
            words: v.words,
            photos: v.photos,
            avg: v.avgN ? v.avgSum / v.avgN : 0,
        }));

        return {
            roundsCount: rounds.length,
            home,
            quoted,
            members: membersList,
        };
    }, [items]);

    const cadence = useMemo(() => {
        if (!foundedAt || !stats.roundsCount) return null;
        const days = Math.max(
            1,
            Math.floor((Date.now() - new Date(foundedAt).getTime()) / 86_400_000),
        );
        const perRound = days / stats.roundsCount;
        if (perRound < 10) return 'roughly weekly';
        if (perRound < 20) return 'roughly every other week';
        if (perRound < 40) return 'about once a month';
        return 'a handful of times a year';
    }, [foundedAt, stats.roundsCount]);

    const foundedLabel = foundedAt
        ? new Date(foundedAt).toLocaleDateString('en-US', {
              day: 'numeric',
              month: 'short',
              year: 'numeric',
          })
        : '';

    return (
        <View style={{ flex: 1, backgroundColor: palette.surfaceJournal }}>
            <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
                <Pressable
                    hitSlop={10}
                    onPress={() => router.back()}
                    accessibilityLabel="Close"
                >
                    <Ionicons name="close" size={22} color={palette.textMuted} />
                </Pressable>
                <Pressable hitSlop={10} accessibilityLabel="Share">
                    <Ionicons name="share-outline" size={20} color={palette.textMuted} />
                </Pressable>
            </View>

            {isLoading ? (
                <View style={styles.loading}>
                    <ActivityIndicator color={palette.primary} />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
                    showsVerticalScrollIndicator={false}
                >
                    {/* Hero */}
                    <View style={styles.hero}>
                        <Text style={[styles.heroKicker, { color: palette.primary }]}>
                            — LOOKING BACK —
                        </Text>
                        <Text style={[styles.heroName, { color: palette.text }]}>
                            {tableName}
                        </Text>
                        <Text
                            style={[styles.heroSub, { color: palette.textSecondary }]}
                        >
                            One year at the table
                        </Text>
                        <View
                            style={[
                                styles.heroRule,
                                { backgroundColor: palette.ruleInkSoft },
                            ]}
                        />
                    </View>

                    {/* Stat 1 — rounds */}
                    <Stat
                        palette={palette}
                        label="Rounds held"
                        big={String(stats.roundsCount)}
                        foot={cadence ?? 'your shared history'}
                    />

                    {/* Stat 2 — home */}
                    {stats.home ? (
                        <Stat
                            palette={palette}
                            label="Your table's home"
                            name={stats.home.name}
                            foot={`${stats.home.count} return${
                                stats.home.count === 1 ? '' : 's'
                            }${
                                stats.home.avg
                                    ? ` \u00B7 average ${stats.home.avg.toFixed(1)}`
                                    : ''
                            }`}
                        />
                    ) : null}

                    {/* Stat 3 — quote */}
                    {stats.quoted && stats.quoted.content ? (
                        <View
                            style={[
                                styles.statBlock,
                                {
                                    borderBottomColor: palette.outlineVariant,
                                },
                            ]}
                        >
                            <Text style={[styles.statLabel, { color: palette.textMuted }]}>
                                QUOTE OF THE YEAR
                            </Text>
                            <Text
                                style={[styles.quoteText, { color: palette.text }]}
                                numberOfLines={4}
                            >
                                {`\u201C${stats.quoted.content}\u201D`}
                            </Text>
                            <Text style={[styles.quoteAttr, { color: palette.textMuted }]}>
                                — {stats.quoted.profiles?.display_name ?? 'Unknown'}
                                {stats.quoted.restaurants
                                    ? `, on ${stats.quoted.restaurants.name}`
                                    : ''}
                            </Text>
                        </View>
                    ) : null}

                    {/* Stat 4 — voices */}
                    {stats.members.length > 0 ? (
                        <View
                            style={[
                                styles.statBlock,
                                { borderBottomColor: palette.outlineVariant },
                            ]}
                        >
                            <Text
                                style={[
                                    styles.statLabel,
                                    { color: palette.textMuted, textAlign: 'center' },
                                ]}
                            >
                                {stats.members.length === 1
                                    ? 'AT THE TABLE'
                                    : `THE ${numberWord(stats.members.length).toUpperCase()} OF YOU`}
                            </Text>
                            <View style={{ marginTop: 12, gap: 6 }}>
                                {stats.members.map((m, i) => (
                                    <View
                                        key={i}
                                        style={styles.memberRow}
                                    >
                                        <Avatar
                                            name={m.name}
                                            url={null}
                                            size={26}
                                            palette={palette}
                                        />
                                        <View style={{ flex: 1 }}>
                                            <Text
                                                style={[
                                                    styles.memberName,
                                                    { color: palette.text },
                                                ]}
                                            >
                                                {m.name}
                                            </Text>
                                            <Text
                                                style={[
                                                    styles.memberMeta,
                                                    { color: palette.textMuted },
                                                ]}
                                            >
                                                {describeMember(m)}
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </View>
                    ) : null}

                    {/* Footer */}
                    <View style={styles.footer}>
                        <Text style={[styles.footerText, { color: palette.textMuted }]}>
                            est. at the table {'\u00B7'} {foundedLabel || 'recently'}
                        </Text>
                        <Pressable
                            onPress={() => router.back()}
                            style={({ pressed }) => [
                                styles.shareBtn,
                                {
                                    borderColor: palette.text,
                                    opacity: pressed ? 0.8 : 1,
                                },
                            ]}
                        >
                            <Text style={[styles.shareText, { color: palette.text }]}>
                                SHARE WITH THE TABLE
                            </Text>
                        </Pressable>
                    </View>
                </ScrollView>
            )}
        </View>
    );
}

function Stat({
    palette,
    label,
    big,
    name,
    foot,
}: {
    palette: typeof Colors.light;
    label: string;
    big?: string;
    name?: string;
    foot?: string;
}) {
    return (
        <View
            style={[styles.statBlock, { borderBottomColor: palette.outlineVariant }]}
        >
            <Text style={[styles.statLabel, { color: palette.textMuted }]}>
                {label.toUpperCase()}
            </Text>
            {big ? (
                <Text style={[styles.statBig, { color: palette.text }]}>{big}</Text>
            ) : null}
            {name ? (
                <Text style={[styles.statName, { color: palette.text }]}>{name}</Text>
            ) : null}
            {foot ? (
                <Text style={[styles.statFoot, { color: palette.textSecondary }]}>
                    {foot}
                </Text>
            ) : null}
        </View>
    );
}

function numberWord(n: number): string {
    const words = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
    return words[n] ?? String(n);
}

function describeMember(m: {
    logs: number;
    words: number;
    photos: number;
    avg: number;
}): string {
    if (m.photos >= 10) return `most photographs \u00B7 ${m.photos}`;
    if (m.words >= 500) return `most words \u00B7 ${m.words} written`;
    if (m.avg) return `average ${m.avg.toFixed(1)} \u00B7 ${m.logs} logs`;
    return `${m.logs} log${m.logs === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
    topBar: {
        paddingHorizontal: 22,
        paddingBottom: 4,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    loading: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    hero: {
        alignItems: 'center',
        paddingTop: 24,
        paddingBottom: 20,
        paddingHorizontal: 32,
    },
    heroKicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 2,
        marginBottom: 14,
    },
    heroName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 30,
        lineHeight: 34,
        textAlign: 'center',
        letterSpacing: -0.4,
        marginBottom: 8,
    },
    heroSub: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 14,
    },
    heroRule: {
        width: 40,
        height: 1,
        marginTop: 14,
    },
    statBlock: {
        paddingVertical: 18,
        paddingHorizontal: 26,
        borderBottomWidth: 1,
        alignItems: 'center',
    },
    statLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        marginBottom: 6,
    },
    statBig: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 54,
        lineHeight: 58,
        letterSpacing: -1.5,
    },
    statName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 28,
        lineHeight: 32,
        letterSpacing: -0.3,
    },
    statFoot: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11,
        marginTop: 6,
        textAlign: 'center',
    },
    quoteText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 25,
        textAlign: 'center',
    },
    quoteAttr: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        letterSpacing: 0.4,
        marginTop: 8,
        textAlign: 'center',
    },
    memberRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    memberName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    memberMeta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
        marginTop: 1,
    },
    footer: {
        paddingTop: 22,
        paddingHorizontal: 26,
        alignItems: 'center',
    },
    footerText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
    },
    shareBtn: {
        marginTop: 14,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 999,
        borderWidth: 1,
        alignSelf: 'stretch',
        alignItems: 'center',
    },
    shareText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.6,
    },
});
