/**
 * JournalNoteCard — Concept B1 "The Memory Object" feed card.
 * Applies to the viewing user's own solo entries on the journal tab.
 *
 * Grammar:
 *   kicker: "noted · tue · kono" (verb + date + companions if any)
 *   restaurant: upright Newsreader masthead
 *   pull-quote: user's content as serif-italic with em-dash + 2px terracotta left rule
 *   empty-note variant: "— no note. the [dish] spoke for itself." or "— no note."
 *   rating: GiantRatingNumeral (X/5 form) in foot row
 *   card: ambient shadow, no hard border, rounded
 *
 * Q8 decision: only use "the [dish] spoke for itself." when dish_description
 * is present and contains ≥1 space OR ≥4 characters. Otherwise fall back to "— no note."
 *
 * Does NOT use extractHighlight — empty note handling is deliberate and explicit.
 */
import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing, Radius, Shadow } from '@/constants/theme';
import { type SoloShareActivity } from '@/hooks/tables/useTableActivity';
import { formatCompanions } from '@/lib/companions';
import { PullQuote, GiantRatingNumeral } from '@/components/ui/napkin';
import { FeedActionRow } from './FeedActionRow';

type Palette = typeof Colors.light;

interface Props {
    item: SoloShareActivity;
    palette: Palette;
    tableId?: string;
    lastSeenAt?: string | null;
}

/**
 * Format visited_at date to a short lowercase label: "tue", "wed apr 13", etc.
 * Falls back to created_at if visited_at is missing.
 */
function formatCardDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    const day = d.toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase();
    const month = d.toLocaleDateString('en-US', { month: 'short' }).toLowerCase();
    const date = d.getDate();
    // If within the last 7 days, just show weekday; otherwise show weekday + month + day
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays < 7) return day;
    return `${day} ${month} ${date}`;
}

/**
 * Q8: only use "the [dish] spoke for itself" when the dish looks like a concrete
 * multi-word item (e.g. "egg sandwich"). Generic single-word entries like
 * "dinner", "omakase", "chicken" read oddly with that construction, so we fall
 * back to a plain "— no note." in those cases.
 */
function emptyNoteText(dish: string | null | undefined): string {
    const trimmed = dish?.trim();
    if (trimmed && trimmed.includes(' ')) {
        return `— no note. the ${trimmed.toLowerCase()} spoke for itself.`;
    }
    return '— no note.';
}

export function JournalNoteCard({ item, palette, tableId, lastSeenAt }: Props) {
    const router = useRouter();

    const restaurantName = item.restaurants?.name ?? 'somewhere';
    const neighborhoodOrCity = item.restaurants?.city ?? item.restaurants?.address ?? null;
    const companionLine = formatCompanions(item.companions);

    const sortDate = item.sort_date ?? item.visited_at ?? item.created_at;
    const isUnseen = !lastSeenAt || (!!sortDate && sortDate > lastSeenAt);
    const dateLabel = formatCardDate(item.visited_at ?? item.sort_date);

    // Kicker: "noted · tue · with clara, thomas" (lowercase, middle-dot separated)
    const kickerParts: string[] = ['noted'];
    if (dateLabel) kickerParts.push(dateLabel);
    if (companionLine) kickerParts.push(companionLine);
    const kicker = kickerParts.join(' · ');

    const hasNote = !!(item.content && item.content.trim().length > 0);
    const hasRating = item.rating != null;

    return (
        <Pressable
            onPress={() => router.push({ pathname: '/entry-detail', params: { entryId: item.id } })}
            style={({ pressed }) => ({ opacity: pressed ? 0.95 : 1 })}
        >
            <View
                style={[
                    styles.card,
                    { backgroundColor: palette.surfaceContainerLow },
                    Shadow.ambient,
                ]}
            >
                {isUnseen ? (
                    <View
                        style={[styles.unseenDot, { backgroundColor: palette.primary }]}
                        accessibilityElementsHidden
                        importantForAccessibility="no"
                    />
                ) : null}

                {/* Kicker — noted · tue · with clara */}
                <Text style={[styles.kicker, { color: palette.textMuted }]} numberOfLines={1}>
                    <Text style={[styles.kickerVerb, { color: palette.primary }]}>noted</Text>
                    {kicker.slice(5) /* everything after "noted" */}
                </Text>

                {/* Restaurant masthead */}
                <Text style={[styles.restaurantName, { color: palette.text }]} numberOfLines={2}>
                    {restaurantName}
                </Text>

                {/* Neighborhood / city meta */}
                {neighborhoodOrCity ? (
                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                        {neighborhoodOrCity}
                    </Text>
                ) : null}

                {/* Pull-quote or empty-note */}
                <View style={styles.quoteArea}>
                    {hasNote ? (
                        <PullQuote
                            text={item.content!.trim()}
                            numberOfLines={3}
                            size="card"
                        />
                    ) : (
                        <Text style={[styles.emptyNote, { color: palette.textMuted }]}>
                            {emptyNoteText(item.dish_description)}
                        </Text>
                    )}
                </View>

                {/* Footer: rating numeral + reactions */}
                <View style={[styles.foot, { borderTopColor: palette.divider }]}>
                    {hasRating ? (
                        <GiantRatingNumeral value={item.rating!} scale="card" />
                    ) : (
                        <View />
                    )}
                    <FeedActionRow
                        targetType="entry"
                        targetId={item.id}
                        reactionCount={item.reaction_count ?? 0}
                        commentCount={item.comment_count ?? 0}
                        myReactions={item.my_reactions ?? []}
                        palette={palette}
                        detailPathname="/entry-detail"
                        detailParams={{ entryId: item.id }}
                        tableId={tableId}
                    />
                </View>
            </View>
        </Pressable>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.lg,
        padding: 22,
        paddingBottom: 18,
        marginBottom: Spacing.md,
        position: 'relative',
    },
    unseenDot: {
        position: 'absolute',
        top: 12,
        right: 12,
        width: 6,
        height: 6,
        borderRadius: 3,
        zIndex: 10,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 2.2,
        textTransform: 'uppercase',
        marginBottom: 10,
    },
    kickerVerb: {
        fontFamily: 'Manrope_700Bold',
    },
    restaurantName: {
        fontFamily: 'Newsreader_500Medium',
        fontSize: 22,
        lineHeight: 27,
        letterSpacing: -0.3,
        fontWeight: '400',
    },
    meta: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 12,
        marginTop: 4,
    },
    quoteArea: {
        marginTop: 18,
    },
    emptyNote: {
        fontFamily: 'Newsreader_400Regular',
        fontSize: 13,
        lineHeight: 20,
    },
    foot: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 16,
        paddingTop: 14,
        borderTopWidth: 1,
    },
});
