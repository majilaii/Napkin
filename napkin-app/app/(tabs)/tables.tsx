/**
 * Tables tab — the daily surface.
 *
 * Matches the Stitch "sunday_roast_activity_feed_updated" wireframe:
 *   - Editorial masthead with hairline rules and italic tagline
 *   - Conditional terracotta "Table Night is live" banner
 *   - Group entry label ("GROUP ENTRY — 14 DEC")
 *   - Featured restaurant card: full-bleed photo, serif name, amber rating
 *     pill, avatar stack, italic editorial blurb
 *   - Activity rows: verb + restaurant, amber rating, scrapbook-clip tags
 *
 * When the user has no table or no activity, we render a DEMO feed using
 * hardcoded wireframe content. This lets us iterate on the UI without
 * needing backend data. The demo ribbon makes it obvious it's not real.
 */

import React, { useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    RefreshControl,
    Pressable,
    ActivityIndicator,
    Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Spacing, Radius, Shadow, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useTables } from '@/hooks/tables/useTables';
import {
    useTableActivity,
    type ActivityItem,
    type SoloShareActivity,
    type TableNightActivity,
} from '@/hooks/tables/useTableActivity';

type Palette = typeof Colors.light;

// ────────────────────────────────────────────────────────────────────────────
// Demo data — matches the Stitch wireframe pixel-for-pixel in content
// ────────────────────────────────────────────────────────────────────────────

const DEMO_TABLE_NAME = 'Sunday Roast Club';

const DEMO_FEATURED = {
    id: 'demo-featured',
    restaurantName: 'Carbone',
    rating: 4.2,
    heroPhoto:
        'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=900&auto=format&fit=crop',
    blurb:
        'The spicy rigatoni lived up to the hype. An evening defined by velvet drapes and too many glasses of Chianti.',
    participants: [
        { name: 'Julian M', url: null },
        { name: 'Clara Rose', url: null },
        { name: 'Thomas H', url: null },
        { name: 'Maya L', url: null },
    ],
};

type DemoRow =
    | {
        kind: 'solo';
        id: string;
        person: string;
        verb: 'tried' | 'noted';
        restaurant: string;
        rating: number | null;
        note: string | null;
        tags?: string[];
    }
    | {
        kind: 'tn';
        id: string;
        restaurant: string;
        rating: number;
    };

const DEMO_ROWS: DemoRow[] = [
    {
        kind: 'solo',
        id: 'demo-1',
        person: 'Maya',
        verb: 'tried',
        restaurant: 'Tatiana',
        rating: 3.4,
        note: 'Chef pastiches were wonderful but the music was a touch too loud for a Tuesday.',
    },
    {
        kind: 'solo',
        id: 'demo-2',
        person: 'Julian',
        verb: 'noted',
        restaurant: 'Apotheke Nomads',
        rating: null,
        note: null,
        tags: ['Café', 'Night', 'Cocktails'],
    },
    {
        kind: 'solo',
        id: 'demo-3',
        person: 'Clara',
        verb: 'tried',
        restaurant: "Lil' Frankie's",
        rating: 4.5,
        note: 'Pizza al taglio, a glass of Montepulciano, perfect Tuesday night.',
    },
];

// ────────────────────────────────────────────────────────────────────────────
// Screen
// ────────────────────────────────────────────────────────────────────────────

export default function TablesScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const { user } = useAuth();

    const { data: tables, isLoading: tablesLoading } = useTables(user?.id);
    const activeTable = tables?.[0]?.tables;

    const {
        data,
        isLoading: feedLoading,
        isRefetching,
        refetch,
    } = useTableActivity(activeTable?.id);

    const items: ActivityItem[] = useMemo(() => data?.pages.flat() ?? [], [data]);

    const { featured, rows } = useMemo(() => {
        const featuredItem = items.find(
            (i): i is TableNightActivity =>
                i.type === 'table_night' && i.status === 'revealed',
        );
        const restItems = items.filter((i) => i !== featuredItem);
        return { featured: featuredItem, rows: restItems };
    }, [items]);

    const isEmpty = !tablesLoading && !feedLoading && !activeTable;
    const hasNoActivity = !!activeTable && !feedLoading && items.length === 0;
    const showDemo = isEmpty || hasNoActivity;

    if (tablesLoading) return <CenteredSpinner palette={palette} />;

    // Table Night banner stub (wire to useActiveTableNight next)
    const activeTableNight = showDemo
        ? { id: 'demo', restaurantName: 'Carbone' }
        : null;

    return (
        <ScrollView
            style={{ flex: 1, backgroundColor: palette.background }}
            contentContainerStyle={{
                paddingTop: insets.top + Spacing.sm,
                paddingBottom: insets.bottom + Spacing.xxl + 80,
            }}
            refreshControl={
                <RefreshControl
                    refreshing={isRefetching}
                    onRefresh={refetch}
                    tintColor={palette.primary}
                />
            }
            showsVerticalScrollIndicator={false}
        >
            {showDemo ? <DemoRibbon palette={palette} /> : null}

            <Masthead
                name={activeTable?.name ?? DEMO_TABLE_NAME}
                palette={palette}
            />

            {activeTableNight ? (
                <TableNightBanner
                    restaurantName={activeTableNight.restaurantName}
                    onPress={() => { /* TODO: router.push(`/table-night/${id}`) */ }}
                    palette={palette}
                />
            ) : null}

            <GroupEntryHeader date={new Date()} palette={palette} />

            {showDemo ? (
                <>
                    <DemoFeaturedCard palette={palette} />
                    <View style={styles.rowList}>
                        {DEMO_ROWS.map((r) => (
                            <DemoRowCard key={r.id} row={r} palette={palette} />
                        ))}
                    </View>
                </>
            ) : (
                <>
                    {featured ? <FeaturedTableNightCard item={featured} palette={palette} /> : null}
                    <View style={styles.rowList}>
                        {rows.map((item) => (
                            <ActivityRow
                                key={`${item.type}-${item.id}`}
                                item={item}
                                palette={palette}
                            />
                        ))}
                    </View>
                </>
            )}

            {isEmpty ? (
                <EmptyCTA palette={palette} />
            ) : hasNoActivity ? (
                <InviteToLogCTA palette={palette} />
            ) : null}
        </ScrollView>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Demo mode ribbon
// ────────────────────────────────────────────────────────────────────────────

function DemoRibbon({ palette }: { palette: Palette }) {
    return (
        <View style={[styles.ribbon, { backgroundColor: palette.secondaryContainer }]}>
            <Text style={[Type.labelSmall, { color: palette.secondary }]}>
                Preview · sample content
            </Text>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Masthead — editorial header with hairline rules + tagline
// ────────────────────────────────────────────────────────────────────────────

function Masthead({ name, palette }: { name: string; palette: Palette }) {
    return (
        <View style={styles.masthead}>
            <View style={[styles.hairline, { backgroundColor: 'rgba(160, 63, 40, 0.25)' }]} />
            <Text
                style={[Type.displayMedium, { color: palette.text, textAlign: 'center' }]}
                numberOfLines={1}
            >
                {name}
            </Text>
            <View style={[styles.hairline, { backgroundColor: 'rgba(160, 63, 40, 0.25)' }]} />
            <Text
                style={[
                    Type.headlineItalic,
                    { color: palette.textSecondary, textAlign: 'center', fontSize: 14, marginTop: Spacing.xs },
                ]}
            >
                est. with those you trust
            </Text>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Table Night banner — terracotta, tap to join
// ────────────────────────────────────────────────────────────────────────────

function TableNightBanner({
    restaurantName,
    onPress,
    palette,
}: {
    restaurantName: string;
    onPress: () => void;
    palette: Palette;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.tnBanner,
                { backgroundColor: palette.primary, opacity: pressed ? 0.9 : 1 },
                Shadow.subtle,
            ]}
        >
            <View style={styles.tnDot} />
            <View style={{ flex: 1 }}>
                <Text style={[Type.label, { color: '#fff' }]}>Table Night is live</Text>
                <Text style={[Type.bodySmall, { color: '#fff', opacity: 0.9, marginTop: 2 }]}>
                    at {restaurantName} · tap to join
                </Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 20, marginLeft: Spacing.sm }}>›</Text>
        </Pressable>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Group entry label
// ────────────────────────────────────────────────────────────────────────────

function GroupEntryHeader({ date, palette }: { date: Date; palette: Palette }) {
    const label = date
        .toLocaleDateString('en-US', { day: 'numeric', month: 'short' })
        .toUpperCase();
    return (
        <View style={styles.groupEntry}>
            <Text style={[Type.label, { color: palette.textSecondary }]}>
                Group entry · {label}
            </Text>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Featured card — real data
// ────────────────────────────────────────────────────────────────────────────

function FeaturedTableNightCard({
    item,
    palette,
}: {
    item: TableNightActivity;
    palette: Palette;
}) {
    return (
        <FeaturedCardLayout
            restaurantName={item.restaurants.name}
            rating={item.average_rating}
            heroPhoto={undefined}
            blurb={item.participants[0]?.notes ?? null}
            participants={item.participants.map((p) => ({
                name: p.profiles.display_name,
                url: p.profiles.avatar_url,
            }))}
            palette={palette}
        />
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Featured card — demo
// ────────────────────────────────────────────────────────────────────────────

function DemoFeaturedCard({ palette }: { palette: Palette }) {
    return (
        <FeaturedCardLayout
            restaurantName={DEMO_FEATURED.restaurantName}
            rating={DEMO_FEATURED.rating}
            heroPhoto={DEMO_FEATURED.heroPhoto}
            blurb={DEMO_FEATURED.blurb}
            participants={DEMO_FEATURED.participants}
            palette={palette}
        />
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Featured card layout (shared)
// ────────────────────────────────────────────────────────────────────────────

function FeaturedCardLayout({
    restaurantName,
    rating,
    heroPhoto,
    blurb,
    participants,
    palette,
}: {
    restaurantName: string;
    rating: number | null;
    heroPhoto: string | undefined;
    blurb: string | null;
    participants: { name: string; url: string | null }[];
    palette: Palette;
}) {
    return (
        <View style={[styles.featuredCard, { backgroundColor: palette.card }, Shadow.ambient]}>
            <View style={[styles.featuredHero, { backgroundColor: palette.surfaceContainerHigh }]}>
                {heroPhoto ? (
                    <Image
                        source={{ uri: heroPhoto }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                    />
                ) : null}
                {rating != null ? (
                    <View style={[styles.ratingPill, { backgroundColor: palette.tertiaryFixed }]}>
                        <Text style={[Type.rating, { color: palette.tertiary, fontSize: 20 }]}>
                            {rating.toFixed(1)}
                        </Text>
                    </View>
                ) : null}
            </View>

            <View style={styles.featuredBody}>
                <Text style={[Type.headlineLarge, { color: palette.text, fontSize: 32, lineHeight: 36 }]}>
                    {restaurantName}
                </Text>

                <AvatarStack participants={participants} palette={palette} />

                {blurb ? (
                    <Text
                        style={[
                            Type.headlineItalic,
                            {
                                color: palette.textSecondary,
                                marginTop: Spacing.md,
                                lineHeight: 26,
                            },
                        ]}
                    >
                        {blurb}
                    </Text>
                ) : null}
            </View>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Activity rows — real data
// ────────────────────────────────────────────────────────────────────────────

function ActivityRow({ item, palette }: { item: ActivityItem; palette: Palette }) {
    if (item.type === 'solo_share') return <SoloShareRow item={item} palette={palette} />;
    return <TableNightRow item={item} palette={palette} />;
}

function SoloShareRow({
    item,
    palette,
}: {
    item: SoloShareActivity;
    palette: Palette;
}) {
    return (
        <RowLayout
            avatar={{ name: item.profiles.display_name, url: item.profiles.avatar_url }}
            person={item.profiles.display_name}
            verb={item.rating != null ? 'tried' : 'noted'}
            restaurant={item.restaurants?.name ?? 'somewhere'}
            note={item.content}
            rating={item.rating}
            tags={undefined}
            palette={palette}
        />
    );
}

function TableNightRow({
    item,
    palette,
}: {
    item: TableNightActivity;
    palette: Palette;
}) {
    return (
        <View style={[styles.tnRow, { backgroundColor: palette.surfaceContainerLow }]}>
            <View style={[styles.tnRowIcon, { backgroundColor: palette.primaryMuted }]}>
                <Text style={{ color: palette.primary, fontSize: 18 }}>◆</Text>
            </View>
            <View style={{ flex: 1 }}>
                <Text style={[Type.labelSmall, { color: palette.primary }]}>Table Night</Text>
                <Text
                    style={[
                        Type.headlineMedium,
                        { color: palette.text, fontSize: 20, marginTop: 2 },
                    ]}
                >
                    {item.restaurants.name}
                </Text>
            </View>
            {item.average_rating != null ? (
                <Text style={[Type.rating, { color: palette.tertiary, fontSize: 22 }]}>
                    {item.average_rating.toFixed(1)}
                </Text>
            ) : null}
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Activity row — demo
// ────────────────────────────────────────────────────────────────────────────

function DemoRowCard({ row, palette }: { row: DemoRow; palette: Palette }) {
    if (row.kind === 'tn') {
        return (
            <View style={[styles.tnRow, { backgroundColor: palette.surfaceContainerLow }]}>
                <View style={[styles.tnRowIcon, { backgroundColor: palette.primaryMuted }]}>
                    <Text style={{ color: palette.primary, fontSize: 18 }}>◆</Text>
                </View>
                <View style={{ flex: 1 }}>
                    <Text style={[Type.labelSmall, { color: palette.primary }]}>Table Night</Text>
                    <Text style={[Type.headlineMedium, { color: palette.text, fontSize: 20, marginTop: 2 }]}>
                        {row.restaurant}
                    </Text>
                </View>
                <Text style={[Type.rating, { color: palette.tertiary, fontSize: 22 }]}>
                    {row.rating.toFixed(1)}
                </Text>
            </View>
        );
    }

    return (
        <RowLayout
            avatar={{ name: row.person, url: null }}
            person={row.person}
            verb={row.verb}
            restaurant={row.restaurant}
            note={row.note}
            rating={row.rating}
            tags={row.tags}
            palette={palette}
        />
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Shared row layout — solo share style
// ────────────────────────────────────────────────────────────────────────────

function RowLayout({
    avatar,
    person,
    verb,
    restaurant,
    note,
    rating,
    tags,
    palette,
}: {
    avatar: { name: string; url: string | null };
    person: string;
    verb: 'tried' | 'noted';
    restaurant: string;
    note: string | null;
    rating: number | null;
    tags?: string[];
    palette: Palette;
}) {
    return (
        <View style={styles.row}>
            <Avatar url={avatar.url} name={avatar.name} size={44} palette={palette} />
            <View style={{ flex: 1 }}>
                <View style={styles.rowHeader}>
                    <View style={{ flex: 1 }}>
                        <Text style={[Type.titleSmall, { color: palette.text }]}>
                            {person}{' '}
                            <Text style={[Type.body, { color: palette.textSecondary, fontWeight: '400' }]}>
                                {verb}
                            </Text>
                        </Text>
                        <Text
                            style={[
                                Type.headlineMedium,
                                { color: palette.text, fontSize: 20, lineHeight: 24, marginTop: 2 },
                            ]}
                            numberOfLines={1}
                        >
                            {restaurant}
                        </Text>
                    </View>
                    {rating != null ? (
                        <Text
                            style={[
                                Type.rating,
                                { color: palette.tertiary, fontSize: 22, marginLeft: Spacing.md },
                            ]}
                        >
                            {rating.toFixed(1)}
                        </Text>
                    ) : null}
                </View>

                {note ? (
                    <Text
                        style={[
                            Type.bodySmall,
                            { color: palette.textMuted, marginTop: Spacing.xs, lineHeight: 18 },
                        ]}
                        numberOfLines={2}
                    >
                        {note}
                    </Text>
                ) : null}

                {tags && tags.length > 0 ? (
                    <View style={styles.tagRow}>
                        {tags.map((t) => (
                            <ScrapbookClip key={t} label={t} palette={palette} />
                        ))}
                    </View>
                ) : null}
            </View>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Scrapbook clip — amber tag chip
// ────────────────────────────────────────────────────────────────────────────

function ScrapbookClip({ label, palette }: { label: string; palette: Palette }) {
    return (
        <View style={[styles.clip, { backgroundColor: palette.tertiaryFixed }]}>
            <Text style={[Type.labelSmall, { color: palette.tertiary }]}>{label}</Text>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Empty & invite CTAs
// ────────────────────────────────────────────────────────────────────────────

function EmptyCTA({ palette }: { palette: Palette }) {
    return (
        <View style={styles.cta}>
            <Text
                style={[
                    Type.headlineMedium,
                    { color: palette.text, textAlign: 'center', lineHeight: 26 },
                ]}
            >
                Set a Table of your own
            </Text>
            <Text
                style={[
                    Type.bodySmall,
                    {
                        color: palette.textSecondary,
                        textAlign: 'center',
                        marginTop: Spacing.sm,
                        marginBottom: Spacing.lg,
                    },
                ]}
            >
                Invite your circle. Log where you ate.{'\n'}Vote together when you sit down.
            </Text>
            <Pressable
                style={({ pressed }) => [
                    styles.primaryCta,
                    { backgroundColor: palette.primary, opacity: pressed ? 0.9 : 1 },
                ]}
            >
                <Text style={[Type.label, { color: '#fff' }]}>Create a Table</Text>
            </Pressable>
        </View>
    );
}

function InviteToLogCTA({ palette }: { palette: Palette }) {
    return (
        <View style={styles.cta}>
            <Text
                style={[Type.bodySmall, { color: palette.textMuted, textAlign: 'center' }]}
            >
                Quiet at the table. Log a meal to start.
            </Text>
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Primitives
// ────────────────────────────────────────────────────────────────────────────

function AvatarStack({
    participants,
    palette,
}: {
    participants: { name: string; url: string | null }[];
    palette: Palette;
}) {
    return (
        <View style={{ flexDirection: 'row', marginTop: Spacing.md, alignItems: 'center' }}>
            {participants.slice(0, 5).map((p, i) => (
                <View key={`${p.name}-${i}`} style={{ marginLeft: i === 0 ? 0 : -10 }}>
                    <Avatar url={p.url} name={p.name} size={32} palette={palette} bordered />
                </View>
            ))}
            {participants.length > 5 ? (
                <Text style={[Type.labelSmall, { color: palette.textSecondary, marginLeft: Spacing.sm }]}>
                    +{participants.length - 5}
                </Text>
            ) : null}
        </View>
    );
}

function Avatar({
    url,
    name,
    size,
    palette,
    bordered = false,
}: {
    url: string | null;
    name: string;
    size: number;
    palette: Palette;
    bordered?: boolean;
}) {
    const initials = name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();

    // Rotating palette for demo avatars so the stack looks lived-in
    const tints = [palette.tertiaryFixed, palette.secondaryContainer, palette.primaryMuted];
    const tint = tints[(initials.charCodeAt(0) || 0) % tints.length];

    const containerStyle = {
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: tint,
        alignItems: 'center' as const,
        justifyContent: 'center' as const,
        borderWidth: bordered ? 2 : 0,
        borderColor: palette.background,
    };

    if (url) return <Image source={{ uri: url }} style={containerStyle} />;

    return (
        <View style={containerStyle}>
            <Text
                style={{
                    ...Type.titleSmall,
                    color: palette.text,
                    fontSize: size * 0.36,
                }}
            >
                {initials}
            </Text>
        </View>
    );
}

function CenteredSpinner({ palette }: { palette: Palette }) {
    return (
        <View style={[styles.emptyRoot, { backgroundColor: palette.background }]}>
            <ActivityIndicator color={palette.primary} />
        </View>
    );
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    emptyRoot: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.xl,
    },

    ribbon: {
        alignSelf: 'center',
        paddingHorizontal: Spacing.md,
        paddingVertical: 6,
        borderRadius: Radius.full,
        marginTop: Spacing.sm,
    },

    masthead: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.md,
        gap: Spacing.md,
    },
    hairline: {
        height: StyleSheet.hairlineWidth,
    },

    tnBanner: {
        marginHorizontal: Spacing.lg,
        marginTop: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.md,
        borderRadius: Radius.lg,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
    },
    tnDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: '#fff',
    },

    groupEntry: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.sm,
    },

    featuredCard: {
        marginHorizontal: Spacing.lg,
        borderRadius: Radius.xl,
        overflow: 'hidden',
    },
    featuredHero: {
        height: 220,
        position: 'relative',
    },
    ratingPill: {
        position: 'absolute',
        top: Spacing.md,
        right: Spacing.md,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.xs,
        borderRadius: Radius.sm,
    },
    featuredBody: {
        padding: Spacing.lg,
    },

    rowList: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.xl,
        gap: Spacing.xl,
    },
    row: {
        flexDirection: 'row',
        gap: Spacing.md,
        alignItems: 'flex-start',
    },
    rowHeader: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    tagRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: Spacing.xs,
        marginTop: Spacing.sm,
    },
    clip: {
        paddingHorizontal: Spacing.sm,
        paddingVertical: 4,
        borderRadius: Radius.sm,
    },

    tnRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.md,
        padding: Spacing.md,
        borderRadius: Radius.lg,
    },
    tnRowIcon: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },

    cta: {
        marginTop: Spacing.xxl,
        marginHorizontal: Spacing.lg,
        alignItems: 'center',
    },
    primaryCta: {
        paddingHorizontal: Spacing.xl,
        paddingVertical: Spacing.md,
        borderRadius: Radius.full,
        minHeight: 48,
        justifyContent: 'center',
    },
});
