/**
 * CuisineFilterSheet — overflow picker for wishlist cuisine filters (b47).
 *
 * The inline chip row caps to the few most-saved cuisines; everything else
 * lives here so the row never devolves into an endless horizontal scroll.
 * Bottom sheet, 2-column flow of cuisine chips with per-cuisine save counts.
 *
 * Heirloom Journal: warm paper sheet, italic serif header, terracotta active
 * chip, Manrope meta. No 1px sectioning borders. No emoji in chrome.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Spacing, Type } from '@/constants/theme';

export interface CuisineCount {
    cuisine: string;
    count: number;
}

interface Props {
    visible: boolean;
    cuisines: CuisineCount[];
    /** Currently-active cuisine filter, or null. */
    selected: string | null;
    onSelect: (cuisine: string | null) => void;
    onDismiss: () => void;
    palette: typeof Colors.light;
}

export function CuisineFilterSheet({
    visible,
    cuisines,
    selected,
    onSelect,
    onDismiss,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();

    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onDismiss}>
            <Pressable style={styles.backdrop} onPress={onDismiss}>
                {/* Inner press-catcher so taps inside the sheet don't dismiss it. */}
                <Pressable
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: palette.surfaceJournal ?? palette.background,
                            paddingBottom: insets.bottom + Spacing.lg,
                        },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={styles.grabber} />

                    <View style={styles.header}>
                        <Text style={[Type.headlineItalic, { color: palette.text, fontSize: 22 }]}>
                            cuisines
                        </Text>
                        {selected ? (
                            <Pressable onPress={() => onSelect(null)} hitSlop={10}>
                                <Text style={[styles.clear, { color: palette.primary }]}>clear</Text>
                            </Pressable>
                        ) : null}
                    </View>

                    <ScrollView
                        style={{ maxHeight: 360 }}
                        contentContainerStyle={styles.grid}
                        showsVerticalScrollIndicator={false}
                    >
                        {cuisines.map(({ cuisine, count }) => {
                            const active = selected === cuisine;
                            return (
                                <Pressable
                                    key={cuisine}
                                    onPress={() => onSelect(active ? null : cuisine)}
                                    style={[
                                        styles.gridChip,
                                        active
                                            ? { backgroundColor: palette.primary }
                                            : { backgroundColor: palette.surfaceJournalLow },
                                    ]}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                >
                                    <Text
                                        numberOfLines={1}
                                        style={[
                                            styles.gridChipLabel,
                                            { color: active ? '#fffdf8' : palette.text },
                                        ]}
                                    >
                                        {cuisine.toLowerCase()}
                                    </Text>
                                    <Text
                                        style={[
                                            styles.gridChipCount,
                                            { color: active ? 'rgba(255,253,248,0.7)' : palette.textMuted },
                                        ]}
                                    >
                                        {count}
                                    </Text>
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
        // Warm dusk, not a black scrim (founder, 2026-07-03).
        backgroundColor: 'rgba(74,55,42,0.25)',
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        paddingHorizontal: 22,
        paddingTop: 10,
    },
    grabber: {
        alignSelf: 'center',
        width: 36,
        height: 4,
        borderRadius: 2,
        backgroundColor: 'rgba(138,114,108,0.4)',
        marginBottom: 14,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 14,
    },
    clear: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 0.5,
        textTransform: 'lowercase',
    },
    grid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        paddingBottom: 4,
    },
    gridChip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
    },
    gridChipLabel: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        maxWidth: 160,
    },
    gridChipCount: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
    },
});
