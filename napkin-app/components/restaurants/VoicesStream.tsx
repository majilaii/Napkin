/**
 * VoicesStream — trust-ring-ordered voice list for Visits tab.
 *
 * Order: You → Your tablemates → dashed divider → Public Napkin users
 * Each row: avatar · name · rating (italic terracotta) · date · italic note
 *
 * Avatar styles:
 *  - self: olive gradient
 *  - tablemate: terracotta gradient
 *  - public: ghosted surface with ink border
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { Colors, Radius, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { PageVisit, PublicReviewCard } from '@/hooks/restaurants/useRestaurantPage';

interface VoiceRowProps {
    kind: 'self' | 'tablemate' | 'followee' | 'public';
    initial: string;
    name: string;
    rating: number | null;
    date: string;
    note?: string | null;
    /** Integer % taste match — appended to line1 for public rows only. null/undefined hides. */
    matchPct?: number | null;
    onPress?: () => void;
    palette: typeof Colors.light;
}

interface Props {
    selfVisits: PageVisit[];
    tablemateVisits: PageVisit[];
    publicReviews: PublicReviewCard[];
    /** Authenticated viewer's id — suppresses calibration chip on their own public rows. */
    viewerUserId?: string | null;
    /** Controlled filter state for "matches mine" toggle pill (TICKET-022 Surface C). */
    matchFilterOn?: boolean;
    onToggleMatchFilter?: () => void;
    onVisitPress?: (visit: PageVisit) => void;
    /** Tap handler for a public review row — routes to /entry-detail?viewAs=public. */
    onPublicReviewPress?: (entry_id: string) => void;
    /**
     * Restaurant name threaded for reading-oriented empty state copy.
     * When provided, zero-voices state reads "— no one's written about {name} yet."
     */
    restaurantName?: string | null;
}

// Calibration filter thresholds (locked for v1 per TICKET-022 AC)
const MATCH_MIN_PCT = 70;
const MATCH_MIN_OVERLAP = 5;
const FILTER_PILL_MIN_QUALIFYING = 3;

function reviewQualifiesForMatchFilter(r: PublicReviewCard): boolean {
    const cal = r.calibration;
    if (!cal) return false;
    return cal.match_pct >= MATCH_MIN_PCT && cal.overlap_n >= MATCH_MIN_OVERLAP;
}

type Palette = typeof Colors.light;

function formatDate(iso: string): string {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch {
        return iso;
    }
}

function getInitial(name: string): string {
    return (name ?? '?')[0]?.toUpperCase() ?? '?';
}

const CREAM = '#f6ecd9';
const RULE_COLOR = 'rgba(221, 192, 186, 0.4)';
const DIVIDER_COLOR = 'rgba(138, 114, 108, 0.3)';

function VoiceRow({ kind, initial, name, rating, date, note, matchPct, onPress, palette }: VoiceRowProps) {
    const avatarContent = (
        <Text style={[styles.avText, kind === 'public' && { color: palette.textSecondary }]}>
            {initial}
        </Text>
    );

    const avatarEl =
        kind === 'self' ? (
            <LinearGradient
                colors={['#a8995f', '#6b7c3a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.av}
            >
                {avatarContent}
            </LinearGradient>
        ) : kind === 'tablemate' ? (
            <LinearGradient
                colors={['#c97557', '#a03f28']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.av}
            >
                {avatarContent}
            </LinearGradient>
        ) : kind === 'followee' ? (
            // people you follow — amber→olive, distinct from self/tablemate/public
            <LinearGradient
                colors={['#cda43f', '#6b7c3a']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.av}
            >
                {avatarContent}
            </LinearGradient>
        ) : (
            <View
                style={[
                    styles.av,
                    {
                        backgroundColor: palette.surfaceContainerLow,
                        borderWidth: 1,
                        borderColor: DIVIDER_COLOR,
                    },
                ]}
            >
                {avatarContent}
            </View>
        );

    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.voice,
                { borderBottomColor: RULE_COLOR, opacity: pressed ? 0.75 : 1 },
            ]}
        >
            {avatarEl}
            <View style={styles.body}>
                <View style={styles.line1}>
                    <Text style={[styles.voiceName, { color: palette.text }]}>{name}</Text>
                    {rating != null ? (
                        <>
                            <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                            <Text style={[styles.ratingText, { color: palette.primary }]}>
                                {rating.toFixed(1)}
                            </Text>
                        </>
                    ) : null}
                    <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                    <Text style={[styles.dateText, { color: palette.textMuted }]}>{formatDate(date)}</Text>
                    {kind === 'public' && matchPct != null ? (
                        <>
                            <Text style={[styles.dot, { color: palette.textMuted }]}>·</Text>
                            <Text
                                style={[styles.matchNumeral, { color: palette.text }]}
                                accessibilityLabel={`${matchPct} percent taste match with this review's author`}
                            >
                                {matchPct}%
                            </Text>
                            <Text style={[styles.matchTail, { color: palette.textSecondary }]}>match</Text>
                        </>
                    ) : null}
                </View>
                {note ? (
                    <Text style={[styles.noteText, { color: palette.textSecondary }]} numberOfLines={2}>
                        {'— '}{note}
                    </Text>
                ) : null}
            </View>
        </Pressable>
    );
}

export function VoicesStream({
    selfVisits,
    tablemateVisits,
    publicReviews,
    viewerUserId,
    matchFilterOn = false,
    onToggleMatchFilter,
    onVisitPress,
    onPublicReviewPress,
    restaurantName,
}: Props) {
    const scheme = useColorScheme();
    const palette = Colors[scheme ?? 'light'] as Palette;

    // Letterboxd "from people you follow" — lift followees into their own tier
    // (above the ring divider) so the public/strangers list never buries them.
    const followeeReviews = React.useMemo(
        () =>
            publicReviews
                .filter((r) => r.is_followee)
                .slice()
                .sort((a, b) => (b.created_at > a.created_at ? 1 : -1)),
        [publicReviews],
    );
    const strangerReviews = React.useMemo(
        () => publicReviews.filter((r) => !r.is_followee),
        [publicReviews],
    );

    const qualifyingPublicCount = strangerReviews.filter(reviewQualifiesForMatchFilter).length;
    const showFilterPill =
        onToggleMatchFilter != null && qualifyingPublicCount >= FILTER_PILL_MIN_QUALIFYING;

    const visiblePublic = React.useMemo(() => {
        if (!matchFilterOn) return strangerReviews;
        return strangerReviews
            .filter(reviewQualifiesForMatchFilter)
            .slice()
            .sort((a, b) => {
                const aMatch = a.calibration!.match_pct;
                const bMatch = b.calibration!.match_pct;
                if (bMatch !== aMatch) return bMatch - aMatch;
                return b.created_at > a.created_at ? 1 : -1;
            });
    }, [strangerReviews, matchFilterOn]);

    const hasPrivateVoices =
        selfVisits.length > 0 || tablemateVisits.length > 0 || followeeReviews.length > 0;
    const total =
        selfVisits.length + tablemateVisits.length + followeeReviews.length + visiblePublic.length;

    if (!hasPrivateVoices && publicReviews.length === 0) {
        const emptyLine = restaurantName
            ? `— no one's written about ${restaurantName} yet.`
            : '— no notes yet.';
        return (
            <View style={styles.empty}>
                <Text style={[styles.emptyText, { color: palette.textMuted }]}>
                    {emptyLine}
                </Text>
            </View>
        );
    }

    return (
        <View style={styles.wrap}>
            {/* Section label */}
            <View style={styles.secRow}>
                <Text style={[styles.secLabel, { color: palette.textMuted }]}>VOICES</Text>
                <Text style={[styles.secCount, { color: palette.textSecondary }]}>{total}</Text>
            </View>

            {/* Self */}
            {selfVisits.map((v) => (
                <VoiceRow
                    key={`self-${v.id}`}
                    kind="self"
                    initial={getInitial(v.user_display_names[0] ?? 'You')}
                    name="You"
                    rating={v.rating}
                    date={v.date}
                    note={v.note}
                    onPress={onVisitPress ? () => onVisitPress(v) : undefined}
                    palette={palette}
                />
            ))}

            {/* Tablemates */}
            {tablemateVisits.map((v) => (
                <VoiceRow
                    key={`tm-${v.id}`}
                    kind="tablemate"
                    initial={getInitial(v.user_display_names[0] ?? 'M')}
                    name={v.user_display_names[0] ?? 'Tablemate'}
                    rating={v.rating}
                    date={v.date}
                    note={v.note}
                    onPress={onVisitPress ? () => onVisitPress(v) : undefined}
                    palette={palette}
                />
            ))}

            {/* People you follow (Letterboxd-style) — own tier above the divider */}
            {followeeReviews.length > 0 ? (
                <>
                    <View style={styles.tierRow}>
                        <Text style={[styles.tierLabel, { color: palette.textSecondary }]}>
                            FROM PEOPLE YOU FOLLOW
                        </Text>
                    </View>
                    {followeeReviews.map((r) => (
                        <VoiceRow
                            key={`fol-${r.entry_id}`}
                            kind="followee"
                            initial={getInitial(r.display_name)}
                            name={r.display_name}
                            rating={r.rating}
                            date={r.created_at}
                            note={r.note_excerpt}
                            onPress={onPublicReviewPress ? () => onPublicReviewPress(r.entry_id) : undefined}
                            palette={palette}
                        />
                    ))}
                </>
            ) : null}

            {/* Ring divider — dashed line + italic murmur (inner voices → strangers).
                Gated on visiblePublic (what's rendered below) so the divider never
                floats above an empty/match-filtered stranger list. */}
            {hasPrivateVoices && visiblePublic.length > 0 ? (
                <View style={[styles.ringDivider, { borderTopColor: DIVIDER_COLOR }]}>
                    <Text style={[styles.ringDividerText, { color: palette.textMuted }]}>
                        — from outside your circle
                    </Text>
                </View>
            ) : null}

            {/* "matches mine" filter pill (TICKET-022 Surface C) */}
            {showFilterPill ? (
                <Pressable
                    onPress={onToggleMatchFilter}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: matchFilterOn }}
                    accessibilityLabel="show reviews from people whose taste matches mine"
                    style={({ pressed }) => [
                        styles.filterPill,
                        matchFilterOn
                            ? { backgroundColor: palette.primary }
                            : { backgroundColor: palette.surfaceContainerHigh },
                        pressed && { opacity: 0.75 },
                    ]}
                >
                    <Text
                        style={[
                            styles.filterPillText,
                            { color: matchFilterOn ? '#ffffff' : palette.textSecondary },
                        ]}
                    >
                        show reviews from people whose taste matches mine
                    </Text>
                </Pressable>
            ) : null}

            {/* Public */}
            {visiblePublic.map((r) => {
                const suppressChip = viewerUserId != null && r.user_id === viewerUserId;
                const matchPct =
                    !suppressChip && r.calibration ? r.calibration.match_pct : null;
                return (
                    <VoiceRow
                        key={`pub-${r.entry_id}`}
                        kind="public"
                        initial={getInitial(r.display_name)}
                        name={r.display_name}
                        rating={r.rating}
                        date={r.created_at}
                        note={r.note_excerpt}
                        matchPct={matchPct}
                        onPress={onPublicReviewPress ? () => onPublicReviewPress(r.entry_id) : undefined}
                        palette={palette}
                    />
                );
            })}
        </View>
    );
}

const styles = StyleSheet.create({
    wrap: {
        paddingHorizontal: 22,
        paddingTop: 4,
    },
    secRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 10,
        paddingTop: 16,
    },
    secLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    secCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 9,
        letterSpacing: 1,
    },
    tierRow: {
        marginTop: 16,
        marginBottom: 6,
    },
    tierLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
    },
    voice: {
        flexDirection: 'row',
        gap: 11,
        paddingVertical: 12,
        borderBottomWidth: 1,
    },
    av: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    avText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        fontWeight: '500',
        color: CREAM,
    },
    body: {
        flex: 1,
    },
    line1: {
        flexDirection: 'row',
        alignItems: 'baseline',
        gap: 7,
        marginBottom: 3,
        flexWrap: 'wrap',
    },
    voiceName: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
    dot: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10,
    },
    ratingText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
        fontWeight: '500',
    },
    dateText: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 10.5,
    },
    noteText: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 13,
        lineHeight: 19,
    },
    ringDivider: {
        marginTop: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        marginBottom: 4,
    },
    ringDividerText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 11.5,
    },
    filterPill: {
        alignSelf: 'flex-start',
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs + 2,
        marginTop: Spacing.xs,
        marginBottom: Spacing.sm,
    },
    filterPillText: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        lineHeight: 17,
    },
    matchNumeral: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 12,
    },
    matchTail: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 10.5,
    },
    empty: {
        paddingHorizontal: 22,
        paddingTop: 20,
    },
    emptyText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 14,
    },
});
