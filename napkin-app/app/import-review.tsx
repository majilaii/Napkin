/**
 * /import-review — confirm the spots from a review-mode import (b47).
 *
 * Reached from the wishlist "to review" band. When auto-save was toggled OFF on
 * the share card, the app still resolves the import in the background (OCR /
 * caption) and PERSISTS the spots, but holds the save. This screen lets you keep
 * or drop each spot; on "save" it prunes the manifest to the kept spots, flips
 * mode → 'auto', and pokes the drain — which runs the normal save+route path
 * (wishlist + chosen lists + table), so there's no duplicated save logic here.
 *
 * Heirloom Journal: warm paper, italic serif names, terracotta tick + CTA. No
 * 1px sectioning borders, no emoji in chrome, lowercase verbs.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToast } from '@/providers/ToastProvider';
import {
    getImport,
    setImportSpots,
    setImportMode,
    removeImport,
    pokeImportQueue,
} from '@/lib/importQueue';
import { deleteAppGroupFile } from '@/modules/media-extract';

export default function ImportReviewScreen() {
    const { jobId } = useLocalSearchParams<{ jobId: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();

    // Snapshot the manifest once — the drain won't touch a held review manifest.
    const manifest = useMemo(() => (jobId ? getImport(jobId) : null), [jobId]);
    const spots = manifest?.spots ?? [];

    const [ticked, setTicked] = useState<Set<string>>(
        () => new Set(spots.map((s) => s.candidate_id)),
    );

    const toggle = (id: string) =>
        setTicked((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    const keptCount = ticked.size;

    const destSummary = useMemo(() => {
        const d = manifest?.destinations;
        const parts: string[] = ['wishlist'];
        if (d?.listIds?.length || d?.newListTitles?.length) {
            const n = (d.listIds?.length ?? 0) + (d.newListTitles?.length ?? 0);
            parts.push(`${n} ${n === 1 ? 'list' : 'lists'}`);
        }
        if (d?.tableId) parts.push('a table');
        return parts.join(' · ');
    }, [manifest]);

    const handleSave = () => {
        if (!manifest || keptCount === 0) return;
        const kept = spots.filter((s) => ticked.has(s.candidate_id));
        setImportSpots(manifest.jobId, kept); // prune to confirmed
        setImportMode(manifest.jobId, 'auto'); // release for the normal save path
        pokeImportQueue(); // kick the drain now
        toast.show(`saving ${keptCount} ${keptCount === 1 ? 'spot' : 'spots'}…`);
        router.back();
    };

    const handleDiscard = () => {
        if (manifest) {
            removeImport(manifest.jobId);
            // Don't leak the copied .mov in the App-Group container (no GC sweep).
            if (manifest.videoPath) {
                try {
                    deleteAppGroupFile(manifest.videoPath);
                } catch {
                    /* best-effort */
                }
            }
        }
        router.back();
    };

    if (!manifest || spots.length === 0) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <Header palette={palette} onBack={() => router.back()} />
                <View style={styles.emptyWrap}>
                    <Text style={[Type.headlineItalic, { color: palette.textMuted, fontSize: 18 }]}>
                        — nothing to review.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />
            <Header palette={palette} onBack={() => router.back()} />

            <Text style={[styles.subtitle, { color: palette.textMuted }]}>
                {`we found ${spots.length} ${spots.length === 1 ? 'spot' : 'spots'} — tap to keep`}
            </Text>

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 120 }}
                showsVerticalScrollIndicator={false}
            >
                {spots.map((s) => {
                    const on = ticked.has(s.candidate_id);
                    const meta = [s.restaurant_city].filter(Boolean).join(' · ');
                    return (
                        <Pressable
                            key={s.candidate_id}
                            onPress={() => toggle(s.candidate_id)}
                            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : on ? 1 : 0.55 }]}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: on }}
                        >
                            <View style={styles.rowText}>
                                <Text style={[styles.name, { color: palette.text }]} numberOfLines={1}>
                                    {s.restaurant_name ?? 'unnamed spot'}
                                </Text>
                                {meta ? (
                                    <Text style={[styles.meta, { color: palette.textMuted }]} numberOfLines={1}>
                                        {meta}
                                    </Text>
                                ) : null}
                            </View>
                            <View
                                style={[
                                    styles.tick,
                                    on
                                        ? { backgroundColor: palette.primary, borderColor: palette.primary }
                                        : { borderColor: palette.outlineVariant },
                                ]}
                            >
                                {on ? <Ionicons name="checkmark" size={15} color="#fffdf8" /> : null}
                            </View>
                        </Pressable>
                    );
                })}
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 14, backgroundColor: palette.background }]}>
                <Text style={[styles.dest, { color: palette.textMuted }]}>{`→ ${destSummary}`}</Text>
                <Pressable
                    onPress={handleSave}
                    disabled={keptCount === 0}
                    style={[styles.cta, { backgroundColor: keptCount === 0 ? palette.outlineVariant : palette.primary }]}
                >
                    <Text style={[styles.ctaLabel, { color: '#fffdf8' }]}>
                        {keptCount === 0 ? 'keep at least one' : `save ${keptCount} ${keptCount === 1 ? 'spot' : 'spots'}`}
                    </Text>
                </Pressable>
                <Pressable onPress={handleDiscard} hitSlop={8} style={styles.discard}>
                    <Text style={[styles.discardLabel, { color: palette.textMuted }]}>discard import</Text>
                </Pressable>
            </View>
        </View>
    );
}

function Header({ palette, onBack }: { palette: typeof Colors.light; onBack: () => void }) {
    return (
        <View style={styles.header}>
            <Pressable onPress={onBack} hitSlop={12} style={styles.headerBack} accessibilityLabel="back">
                <Ionicons name="chevron-back" size={22} color={palette.textMuted} />
            </Pressable>
            <Text style={[styles.headerTitle, { color: palette.text }]}>review spots</Text>
            <View style={styles.headerBack} />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    emptyWrap: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 80,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 18,
        paddingTop: Spacing.sm,
        paddingBottom: Spacing.xs,
    },
    headerBack: { width: 32, alignItems: 'flex-start' },
    headerTitle: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
    },
    subtitle: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        paddingHorizontal: 22,
        paddingBottom: Spacing.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 13,
    },
    rowText: { flex: 1, gap: 3 },
    name: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 17,
        lineHeight: 21,
    },
    meta: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
    },
    tick: {
        width: 26,
        height: 26,
        borderRadius: 13,
        borderWidth: 2,
        alignItems: 'center',
        justifyContent: 'center',
    },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 22,
        paddingTop: 12,
        gap: 10,
    },
    dest: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 12,
        textAlign: 'center',
    },
    cta: {
        height: 52,
        borderRadius: 15,
        alignItems: 'center',
        justifyContent: 'center',
    },
    ctaLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
        letterSpacing: 0.3,
    },
    discard: {
        alignSelf: 'center',
        paddingVertical: 4,
    },
    discardLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
    },
});
