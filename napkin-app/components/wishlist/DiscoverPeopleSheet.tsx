/**
 * DiscoverPeopleSheet — the Map tab's "whose pins" picker (TICKET-137).
 *
 * Replaces the inline friend rail (founder: "very bugged"). EXCLUSIVE-include
 * semantics: an `Everyone` row at the top (checked when nothing else is) plus one
 * row per person you follow who has pins (avatar + name + check). Nothing checked
 * = everyone; checking a person shows ONLY their pins. The screen owns the
 * `checkedIds` set and the filtering (mapItems.ts helpers) — this just draws.
 *
 * Same RN-core Modal idiom as FilterTabsSheet: transparent + slide, tap-the-scrim
 * to dismiss, inner Pressable swallows taps, warm-dusk backdrop (no black scrim).
 * Copy economy: one Manrope header line; rows carry no prose.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius } from '@/constants/theme';
import type { DiscoverPerson } from './mapItems';

interface Props {
    visible: boolean;
    onDismiss: () => void;
    palette: typeof Colors.light;
    people: DiscoverPerson[];
    /** Empty = everyone; else the checked (exclusive-include) author ids. */
    checkedIds: ReadonlySet<string>;
    /** Toggle one person in/out of the checked set. */
    onToggle: (id: string) => void;
    /** Clear back to everyone (the `Everyone` row). */
    onEveryone: () => void;
}

export function DiscoverPeopleSheet({
    visible,
    onDismiss,
    palette,
    people,
    checkedIds,
    onToggle,
    onEveryone,
}: Props) {
    const insets = useSafeAreaInsets();
    const everyone = checkedIds.size === 0;

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <Pressable style={styles.backdrop} onPress={onDismiss}>
                <Pressable
                    style={[
                        styles.sheet,
                        { backgroundColor: palette.surfaceNote, paddingBottom: insets.bottom + 16 },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />

                    <Text style={[styles.header, { color: palette.textMuted }]}>Show pins from</Text>

                    <ScrollView
                        style={styles.scroll}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {/* Everyone — clears the exclusive set. */}
                        <Pressable
                            onPress={onEveryone}
                            style={styles.row}
                            accessibilityRole="button"
                            accessibilityState={{ selected: everyone }}
                            accessibilityLabel="everyone"
                        >
                            <View style={[styles.avatar, { backgroundColor: palette.primaryMuted }]}>
                                <Ionicons name="people" size={17} color={palette.primary} />
                            </View>
                            <Text
                                style={[
                                    styles.name,
                                    {
                                        color: everyone ? palette.primary : palette.text,
                                        fontFamily: everyone ? 'Manrope_700Bold' : 'Manrope_500Medium',
                                    },
                                ]}
                            >
                                Everyone
                            </Text>
                            {everyone ? (
                                <Ionicons name="checkmark" size={18} color={palette.primary} />
                            ) : null}
                        </Pressable>

                        {people.map((p) => {
                            const checked = checkedIds.has(p.id);
                            return (
                                <Pressable
                                    key={p.id}
                                    onPress={() => onToggle(p.id)}
                                    style={styles.row}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: checked }}
                                    accessibilityLabel={p.name}
                                >
                                    <View style={[styles.avatar, { backgroundColor: palette.primaryMuted }]}>
                                        {p.avatar ? (
                                            <ExpoImage
                                                source={{ uri: p.avatar }}
                                                style={styles.avatarImg}
                                                contentFit="cover"
                                            />
                                        ) : (
                                            <Text style={[styles.avatarInitial, { color: palette.primary }]}>
                                                {(p.name.trim()[0] ?? '?').toUpperCase()}
                                            </Text>
                                        )}
                                    </View>
                                    <Text
                                        style={[
                                            styles.name,
                                            {
                                                color: checked ? palette.primary : palette.text,
                                                fontFamily: checked ? 'Manrope_700Bold' : 'Manrope_500Medium',
                                            },
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {p.name}
                                    </Text>
                                    {checked ? (
                                        <Ionicons name="checkmark" size={18} color={palette.primary} />
                                    ) : null}
                                </Pressable>
                            );
                        })}
                    </ScrollView>
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
        // Warm dusk, not a black scrim (matches FilterTabsSheet).
        backgroundColor: 'rgba(74,55,42,0.25)',
    },
    sheet: {
        borderTopLeftRadius: Radius.xl,
        borderTopRightRadius: Radius.xl,
        paddingTop: 8,
    },
    grabber: {
        width: 40,
        height: 5,
        borderRadius: Radius.sm,
        alignSelf: 'center',
        opacity: 0.5,
        marginBottom: 4,
    },
    header: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        paddingHorizontal: 24,
        paddingTop: 10,
        paddingBottom: 2,
    },
    scroll: {
        maxHeight: 400,
        marginTop: 2,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 11,
        paddingHorizontal: 24,
    },
    avatar: {
        width: 34,
        height: 34,
        borderRadius: 17,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
    },
    avatarImg: {
        width: '100%',
        height: '100%',
    },
    avatarInitial: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 14,
        includeFontPadding: false,
    },
    name: {
        flex: 1,
        fontSize: 16,
    },
});

export default DiscoverPeopleSheet;
