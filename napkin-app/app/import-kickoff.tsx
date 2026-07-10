/**
 * /import-kickoff — the migration moment (TICKET-152).
 *
 * A large Maps list (>20) enumerated in the background and is HELD here. One
 * screen: the list's name, how many places, an editable destination-list name,
 * and a "pin all" toggle (default ON). Confirm flips the job to `running` and
 * the drain client-pumps it in chunks of 20; the user lands on /import-progress
 * to watch "41 of 117" climb.
 *
 * Copy economy: functional labels in Manrope; the list TITLE (content) is the
 * only serif-italic. No explanatory sentence stacking. Theme tokens only.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useToast } from '@/providers/ToastProvider';
import { getImport, setLargeJob, removeImport, pokeImportQueue } from '@/lib/importQueue';

export default function ImportKickoffScreen() {
    const { jobId } = useLocalSearchParams<{ jobId: string }>();
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();

    // Snapshot the enumerated job once — the drain holds a kickoff manifest.
    const job = useMemo(() => (jobId ? getImport(jobId)?.largeJob ?? null : null), [jobId]);

    const [listName, setListName] = useState<string>(() => job?.destListTitle ?? job?.title ?? '');
    const [pinAll, setPinAll] = useState<boolean>(() => job?.pinAll ?? true);

    const listCount = job?.listCount ?? 0;
    const trimmedName = listName.trim();
    // A destination is required: pin all to the wishlist, OR file into a named list.
    const canStart = pinAll || trimmedName.length > 0;

    const start = () => {
        if (!job || !jobId || !canStart) return;
        setLargeJob(jobId, {
            ...job,
            phase: 'running',
            pinAll,
            destListTitle: trimmedName.length > 0 ? trimmedName : null,
        });
        pokeImportQueue();
        toast.show(`importing ${listCount} ${listCount === 1 ? 'place' : 'places'}…`);
        // Land on the progress hub so the count climbs live (hierarchical: back
        // from there returns to wherever the sheet opened over).
        router.replace('/import-progress' as any);
    };

    const discard = () => {
        if (jobId) removeImport(jobId);
        router.back();
    };

    if (!job) {
        return (
            <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
                <Stack.Screen options={{ headerShown: false }} />
                <View style={styles.topBar}>
                    <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                        <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                    </Pressable>
                </View>
                <View style={styles.emptyWrap}>
                    <Text style={[Type.headlineItalic, { color: palette.textMuted, fontSize: 18 }]}>
                        — nothing to import.
                    </Text>
                </View>
            </View>
        );
    }

    return (
        <View style={[styles.container, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <Stack.Screen options={{ headerShown: false }} />

            <View style={styles.topBar}>
                <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="back">
                    <Ionicons name="chevron-back" size={20} color={palette.textMuted} />
                </Pressable>
            </View>

            <ScrollView
                contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
            >
                {/* Content: the list TITLE (serif italic) + place count (Manrope). */}
                <Text style={[styles.title, { color: palette.text }]}>
                    {job.title ?? 'your map'}
                </Text>
                <Text style={[styles.count, { color: palette.textMuted }]}>
                    {`${listCount} ${listCount === 1 ? 'place' : 'places'}`}
                </Text>

                <View style={[styles.divider, { backgroundColor: palette.ruleInkSoft }]} />

                {/* Destination list name — editable, prefilled with the list title. */}
                <Text style={[styles.fieldLabel, { color: palette.textMuted }]}>SAVE TO A LIST</Text>
                <TextInput
                    value={listName}
                    onChangeText={setListName}
                    placeholder="list name (or leave blank)"
                    placeholderTextColor={palette.textMuted}
                    style={[styles.input, { color: palette.text, borderBottomColor: palette.ruleInkSoft }]}
                    autoCapitalize="sentences"
                    autoCorrect
                    returnKeyType="done"
                    maxLength={60}
                />

                {/* Pin-all toggle — default ON. */}
                <Pressable
                    onPress={() => setPinAll((v) => !v)}
                    style={styles.toggleRow}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: pinAll }}
                    accessibilityLabel="pin all to your wishlist"
                >
                    <Text style={[styles.toggleLabel, { color: palette.text }]}>pin all to wishlist</Text>
                    <View
                        style={[
                            styles.track,
                            {
                                backgroundColor: pinAll ? palette.primary : palette.outlineVariant,
                                alignItems: pinAll ? 'flex-end' : 'flex-start',
                            },
                        ]}
                    >
                        <View style={[styles.knob, { backgroundColor: '#fffdf8' }]} />
                    </View>
                </Pressable>
            </ScrollView>

            <View style={[styles.footer, { paddingBottom: insets.bottom + 14, backgroundColor: palette.background }]}>
                <Pressable
                    onPress={start}
                    disabled={!canStart}
                    style={[styles.cta, { backgroundColor: canStart ? palette.primary : palette.outlineVariant }]}
                    accessibilityRole="button"
                >
                    <Text style={[styles.ctaLabel, { color: '#fffdf8' }]}>
                        {canStart ? `start import` : 'pick a destination'}
                    </Text>
                </Pressable>
                <Pressable onPress={discard} hitSlop={8} style={styles.discard} accessibilityRole="button">
                    <Text style={[styles.discardLabel, { color: palette.textMuted }]}>discard</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    topBar: { paddingHorizontal: 22, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
    title: { fontFamily: 'Newsreader_400Regular_Italic', fontSize: 30, lineHeight: 34, marginTop: Spacing.sm },
    count: { fontFamily: 'Manrope_500Medium', fontSize: 14, marginTop: 6 },
    divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.lg, opacity: 0.6 },
    fieldLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 9.5,
        letterSpacing: 1.5,
        marginBottom: Spacing.sm,
    },
    input: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        marginBottom: Spacing.xl,
    },
    toggleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    toggleLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
    track: {
        width: 46,
        height: 28,
        borderRadius: 14,
        padding: 3,
        justifyContent: 'center',
    },
    knob: { width: 22, height: 22, borderRadius: 11 },
    footer: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        paddingHorizontal: 22,
        paddingTop: 12,
        gap: 10,
    },
    cta: { height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
    ctaLabel: { fontFamily: 'Manrope_700Bold', fontSize: 15, letterSpacing: 0.3 },
    discard: { alignSelf: 'center', paddingVertical: 4 },
    discardLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
});
