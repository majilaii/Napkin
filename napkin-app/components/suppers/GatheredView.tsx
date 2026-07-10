/**
 * GatheredView — the Supper v2 "gathered view" (TICKET-082 v2, design section 4).
 *
 * The heart of a supper: read around the table. Restaurant-anchored (NOT a person's
 * review — this is why it lives on app/supper/[id], not entry-detail). Leads with a
 * collage of the night's pooled photos, then "what the table said" (group avg +
 * per-axis averages), then every take as a one-line verdict. Your seat sits as a peer
 * ("you"); empty seats stay ghosted rows so the table reads visibly unfinished.
 *
 * Per-take detail = the take's own entry → tap a filled row to open entry-detail.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Image, StyleSheet, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { PhotoLightbox } from '@/components/photos';
import { InitialsAvatar } from './InitialsAvatar';
import type { SupperDetail, SupperTake } from '@/hooks/suppers';

type Palette = typeof Colors.light;

interface GatheredViewProps {
    detail: SupperDetail;
    viewerId: string;
    palette: Palette;
    onBack: () => void;
    onOpenTake: (entryId: string) => void;
    /** Shown when the viewer is a roster member who hasn't taken yet. */
    onAddTake?: () => void;
    /**
     * Host-only: opens the delete-supper confirm sheet (TICKET-161). When passed,
     * an ⋯ overflow renders at the right end of the back row — same grammar as
     * entry-detail's owner ⋯. Absent (not disabled) for non-hosts.
     */
    onRequestDelete?: () => void;
}

function avg(nums: Array<number | null | undefined>): number | null {
    const vals = nums.filter((n): n is number => n != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function firstLine(content: string | null): string | null {
    if (!content) return null;
    const line = content.trim().split('\n')[0];
    return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/**
 * TICKET-159 lineage dates — short-date, lowercase, HKT: '30 jun'.
 * Accepts an ISO timestamptz (planned) or a 'YYYY-MM-DD' (gathered — parsed as
 * UTC midnight, which formats to the same calendar day in HKT).
 */
function lineageDate(iso: string): string {
    const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return iso;
    return d
        .toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' })
        .toLowerCase();
}

export function GatheredView({ detail, viewerId, palette, onBack, onOpenTake, onAddTake, onRequestDelete }: GatheredViewProps) {
    const { restaurant, roster, takes, lineage } = detail;
    const restaurantName = restaurant?.name ?? 'the table';

    const takeByUser = useMemo(() => new Map(takes.map((t) => [t.user_id, t])), [takes]);
    const headCount = takes.length;
    const seatCount = roster.length;
    const groupAvg = avg(takes.map((t) => t.rating));

    const axes = [
        { label: 'Food', value: avg(takes.map((t) => t.flavor_rating)) },
        { label: 'Vibe', value: avg(takes.map((t) => t.vibe_rating)) },
        { label: 'Service', value: avg(takes.map((t) => t.service_rating)) },
    ];

    // Pooled photos with attribution (hero per take first, then galleries).
    const photos = useMemo(() => {
        const out: Array<{ uri: string; name: string | null }> = [];
        const seen = new Set<string>();
        const push = (uri: string | null, name: string | null) => {
            if (!uri || seen.has(uri)) return;
            seen.add(uri);
            out.push({ uri, name });
        };
        for (const t of takes) push(t.photo_url, t.display_name);
        for (const t of takes) for (const p of t.photos ?? []) push(p, t.display_name);
        return out;
    }, [takes]);

    // Ordering: filled takes first (created order), then pending seats.
    const orderedSeats = useMemo(() => {
        const filled = roster
            .filter((r) => takeByUser.has(r.user_id))
            .sort((a, b) => {
                const ta = takeByUser.get(a.user_id)!.created_at;
                const tb = takeByUser.get(b.user_id)!.created_at;
                return ta.localeCompare(tb);
            });
        const pending = roster.filter((r) => !takeByUser.has(r.user_id));
        return [...filled, ...pending];
    }, [roster, takeByUser]);

    const viewerPending = roster.some((r) => r.user_id === viewerId) && !takeByUser.has(viewerId);

    // Tap any pooled photo → full-screen pager opened at that index.
    const photoUris = useMemo(() => photos.map((p) => p.uri), [photos]);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    return (
        <View style={[styles.screen, { backgroundColor: palette.surface }]}>
            {/* Top bar — back (left) + host-only ⋯ overflow (right). The row is a
                plain container; back and ⋯ are SIBLING Pressables so the ⋯ tap
                isn't swallowed by an outer full-row onPress. */}
            <View style={styles.topBar}>
                <Pressable onPress={onBack} hitSlop={10} style={styles.backRow} accessibilityRole="button" accessibilityLabel="back to the table">
                    <Ionicons name="chevron-back" size={22} color={palette.text} />
                    <Text style={[styles.backText, { color: palette.textMuted }]}>back</Text>
                </Pressable>
                {onRequestDelete ? (
                    <Pressable onPress={onRequestDelete} hitSlop={10} style={styles.moreBtn} accessibilityRole="button" accessibilityLabel="more options">
                        <Ionicons name="ellipsis-horizontal" size={20} color={palette.textMuted} />
                    </Pressable>
                ) : null}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>
                {/* Header */}
                <View style={styles.header}>
                    <Text style={[styles.title, { color: palette.text }]}>
                        {headCount} gathered at {restaurantName}
                    </Text>
                    {/* TICKET-159 provenance — one quiet meta line, only for a
                        gather-born supper: `planned 30 jun · gathered 10 jul`. */}
                    {lineage ? (
                        <Text style={[styles.lineage, { color: palette.textMuted }]} numberOfLines={1}>
                            planned {lineageDate(lineage.planned)} · gathered {lineageDate(lineage.gathered)}
                        </Text>
                    ) : null}
                    <View style={styles.headerMeta}>
                        <View style={styles.avatarRow}>
                            {roster.slice(0, 5).map((r, i) => (
                                <View key={r.user_id} style={{ marginLeft: i === 0 ? 0 : -7, borderRadius: 13, borderWidth: 2, borderColor: palette.surface, opacity: takeByUser.has(r.user_id) ? 1 : 0.34 }}>
                                    <InitialsAvatar name={r.display_name} avatarUrl={r.avatar_url} size={22} palette={palette} />
                                </View>
                            ))}
                        </View>
                        <Text style={[styles.metaKicker, { color: palette.textMuted }]}>the table · avg</Text>
                        {groupAvg != null ? (
                            <Text style={[styles.metaAvg, { color: palette.tertiary }]}>{groupAvg.toFixed(1)}<Text style={styles.metaAvgDenom}>/5</Text></Text>
                        ) : (
                            <Text style={[styles.metaKicker, { color: palette.textMuted }]}>—</Text>
                        )}
                    </View>
                </View>

                {/* The night — photo collage */}
                {photos.length > 0 ? (
                    <View style={styles.section}>
                        <View style={styles.sectionHead}>
                            <Text style={[styles.sectionKicker, { color: palette.textMuted }]}>the night</Text>
                            <Text style={[styles.sectionMeta, { color: palette.textMuted }]}>{photos.length} {photos.length === 1 ? 'photo' : 'photos'} · everyone&rsquo;s</Text>
                        </View>
                        {/* Hero + 3-col grid — tap any tile to open the full-screen pager */}
                        <Pressable style={styles.heroWrap} onPress={() => setLightboxIndex(0)} accessibilityRole="button" accessibilityLabel="open photo">
                            <Image source={{ uri: photos[0].uri }} style={styles.hero} resizeMode="cover" />
                            {photos[0].name ? (
                                <View style={[styles.attrib, { backgroundColor: palette.placesOverlayTint + 'd9' }]}>
                                    <InitialsAvatar name={photos[0].name} avatarUrl={null} size={18} palette={palette} />
                                    <Text style={[styles.attribName, { color: palette.text }]}>{photos[0].name}</Text>
                                </View>
                            ) : null}
                        </Pressable>
                        {photos.length > 1 ? (
                            <View style={styles.grid}>
                                {photos.slice(1, 7).map((p, i) => {
                                    const idx = i + 1;
                                    const remaining = photos.length - 7;
                                    const isLastTile = i === 5 && remaining > 0;
                                    return (
                                        <Pressable
                                            key={`${p.uri}-${i}`}
                                            style={styles.gridTile}
                                            onPress={() => setLightboxIndex(idx)}
                                            accessibilityRole="button"
                                            accessibilityLabel="open photo"
                                        >
                                            <Image source={{ uri: p.uri }} style={styles.gridTileImg} resizeMode="cover" />
                                            {isLastTile ? (
                                                <View style={styles.gridMore}>
                                                    <Text style={styles.gridMoreText}>+{remaining}</Text>
                                                </View>
                                            ) : null}
                                        </Pressable>
                                    );
                                })}
                            </View>
                        ) : null}
                    </View>
                ) : null}

                {/* What the table said */}
                <View style={[styles.saidCard, { backgroundColor: palette.surfaceNote }]}>
                    <Text style={[styles.saidKicker, { color: palette.primary }]}>what the table said</Text>
                    <Text style={[styles.saidLine, { color: palette.textSecondary }]}>
                        {headCount > 0
                            ? `— ${headCount} ${headCount === 1 ? 'take' : 'takes'} in${groupAvg != null ? `, landing around ${groupAvg.toFixed(1)} out of 5` : ''}.`
                            : '— no one has added a take yet. be the first.'}
                    </Text>
                    {headCount > 0 ? (
                        <View style={styles.axes}>
                            {axes.map((ax) => (
                                <View key={ax.label} style={styles.axis}>
                                    <View style={styles.axisHead}>
                                        <Text style={[styles.axisLabel, { color: palette.textMuted }]}>{ax.label}</Text>
                                        <Text style={[styles.axisVal, { color: palette.tertiary }]}>{ax.value != null ? ax.value.toFixed(1) : '—'}</Text>
                                    </View>
                                    <View style={[styles.axisTrack, { backgroundColor: palette.surfaceContainerHigh }]}>
                                        <View style={[styles.axisFill, { backgroundColor: palette.secondary, width: `${((ax.value ?? 0) / 5) * 100}%` }]} />
                                    </View>
                                </View>
                            ))}
                        </View>
                    ) : null}
                </View>

                {/* Every take */}
                <View style={styles.section}>
                    <Text style={[styles.sectionKicker, { color: palette.textMuted, marginBottom: 4 }]}>every take</Text>
                    {orderedSeats.map((seat, i) => {
                        const take: SupperTake | undefined = takeByUser.get(seat.user_id);
                        const isYou = seat.user_id === viewerId;
                        const filled = !!take;
                        const name = isYou ? 'you' : seat.display_name ?? 'Member';
                        // The viewer's just-added take carries an optimistic id until the
                        // refetch lands — not openable yet (would 404 in entry-detail).
                        const openable = filled && !take!.entry_id.startsWith('optimistic-');
                        return (
                            <Pressable
                                key={seat.user_id}
                                onPress={openable ? () => onOpenTake(take!.entry_id) : undefined}
                                style={[styles.takeRow, i > 0 ? { borderTopWidth: 1, borderTopColor: palette.dividerSoft } : undefined]}
                                accessibilityRole={openable ? 'button' : undefined}
                            >
                                <View style={{ opacity: filled ? 1 : 0.34 }}>
                                    <InitialsAvatar name={seat.display_name} avatarUrl={seat.avatar_url} size={32} palette={palette} />
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text numberOfLines={1}>
                                        <Text style={[styles.takeName, { color: filled ? palette.text : palette.textMuted }]}>{name}</Text>
                                        {filled && firstLine(take!.content) ? (
                                            <Text style={[styles.takeQuote, { color: palette.textMuted }]}> — {firstLine(take!.content)}</Text>
                                        ) : !filled ? (
                                            <Text style={[styles.takePending, { color: palette.textMuted }]}> — hasn&rsquo;t added yet</Text>
                                        ) : null}
                                    </Text>
                                </View>
                                {filled && take!.rating != null ? (
                                    <Text style={[styles.takeRating, { color: palette.tertiary }]}>{take!.rating % 1 === 0 ? `${take!.rating}.0` : take!.rating}</Text>
                                ) : null}
                            </Pressable>
                        );
                    })}
                </View>

                {/* Add your take — viewer is a pending seat */}
                {viewerPending && onAddTake ? (
                    <Pressable onPress={onAddTake} style={({ pressed }) => [styles.addCta, { backgroundColor: palette.primary, opacity: pressed ? 0.9 : 1 }]} accessibilityRole="button">
                        <Ionicons name="add" size={18} color="#fff" />
                        <Text style={styles.addCtaText}>add your take</Text>
                    </Pressable>
                ) : null}
            </ScrollView>

            <PhotoLightbox
                visible={lightboxIndex != null}
                photos={photoUris}
                initialIndex={lightboxIndex ?? 0}
                onClose={() => setLightboxIndex(null)}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    screen: { flex: 1 },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: 10 },
    backRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    backText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
    moreBtn: { padding: 2 },
    header: { paddingHorizontal: Spacing.lg, paddingTop: 4 },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 24, letterSpacing: -0.3 },
    // Lineage — muted Manrope meta under the title; context, never content.
    lineage: { fontFamily: 'Manrope_500Medium', fontSize: 12, letterSpacing: 0.2, marginTop: 6 },
    headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 10 },
    avatarRow: { flexDirection: 'row' },
    metaKicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase' },
    metaAvg: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 18 },
    metaAvgDenom: { fontSize: 11 },
    section: { paddingHorizontal: Spacing.lg, marginTop: 22 },
    sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 },
    sectionKicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' },
    sectionMeta: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
    heroWrap: { position: 'relative', borderRadius: 14, overflow: 'hidden' },
    hero: { width: '100%', height: 200 },
    attrib: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 3, paddingRight: 9, paddingVertical: 3, borderRadius: 9999 },
    attribName: { fontFamily: 'Manrope_600SemiBold', fontSize: 10 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
    gridTile: { width: '31.6%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', position: 'relative' },
    gridTileImg: { width: '100%', height: '100%' },
    gridMore: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(28,28,25,0.5)', alignItems: 'center', justifyContent: 'center' },
    gridMoreText: { fontFamily: 'Manrope_700Bold', fontSize: 18, color: '#fff' },
    saidCard: { marginHorizontal: Spacing.lg, marginTop: 20, borderRadius: 16, padding: 15 },
    saidKicker: { fontFamily: 'Manrope_700Bold', fontSize: 10, letterSpacing: 1.8, textTransform: 'uppercase' },
    saidLine: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 15, lineHeight: 22, marginTop: 9 },
    axes: { flexDirection: 'row', gap: 16, marginTop: 14 },
    axis: { flex: 1 },
    axisHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    axisLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
    axisVal: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 14 },
    axisTrack: { height: 5, borderRadius: 9999, marginTop: 6, overflow: 'hidden' },
    axisFill: { height: 5, borderRadius: 9999 },
    takeRow: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11 },
    takeName: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 16 },
    takeQuote: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 13 },
    takePending: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
    takeRating: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 17 },
    addCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 50, borderRadius: 9999, marginHorizontal: Spacing.lg, marginTop: 24 },
    addCtaText: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#fff' },
});
