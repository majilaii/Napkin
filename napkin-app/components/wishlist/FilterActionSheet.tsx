/**
 * FilterActionSheet — the Wishlist filter dropdowns (Cuisine · Price · Sort).
 *
 * One generic scrim bottom-sheet (Heirloom "filter action sheet"): a grab handle,
 * an uppercase title, then a list of options with a terracotta checkmark on the
 * selected one. Drives all three filter menus on the Wishlist tab.
 *
 * Pattern mirrors CuisineFilterSheet (RN core Modal, transparent + slide,
 * tap-the-scrim-to-dismiss, inner Pressable swallows taps).
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet, Modal, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';

export interface FilterOption {
    /** Stable value; `null` represents the "reset / show all" choice. */
    value: string | null;
    label: string;
    /** Optional trailing count (e.g. cuisine frequency). */
    count?: number;
}

interface Props {
    visible: boolean;
    title: string;
    options: FilterOption[];
    selected: string | null;
    onSelect: (value: string | null) => void;
    onDismiss: () => void;
    palette: typeof Colors.light;
}

export function FilterActionSheet({
    visible,
    title,
    options,
    selected,
    onSelect,
    onDismiss,
    palette,
}: Props) {
    const insets = useSafeAreaInsets();

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
            <Pressable style={styles.backdrop} onPress={onDismiss}>
                <Pressable
                    style={[
                        styles.sheet,
                        {
                            backgroundColor: palette.surfaceNote,
                            paddingBottom: insets.bottom + Spacing.lg,
                        },
                    ]}
                    onPress={(e) => e.stopPropagation()}
                >
                    <View style={[styles.grabber, { backgroundColor: palette.ruleWarmNib }]} />
                    <Text style={[Type.label, styles.title, { color: palette.textMuted }]}>
                        {title}
                    </Text>
                    <ScrollView
                        style={styles.scroll}
                        showsVerticalScrollIndicator={false}
                        keyboardShouldPersistTaps="handled"
                    >
                        {options.map((opt) => {
                            const active = selected === opt.value;
                            return (
                                <Pressable
                                    key={opt.value ?? '__all__'}
                                    onPress={() => onSelect(opt.value)}
                                    style={styles.optionRow}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                >
                                    <Text
                                        style={[
                                            styles.optionLabel,
                                            {
                                                color: active ? palette.primary : palette.text,
                                                fontFamily: active
                                                    ? 'Manrope_700Bold'
                                                    : 'Manrope_500Medium',
                                            },
                                        ]}
                                    >
                                        {opt.label}
                                        {opt.count != null ? (
                                            <Text style={{ color: palette.textMuted }}>
                                                {`  ${opt.count}`}
                                            </Text>
                                        ) : null}
                                    </Text>
                                    {active ? (
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
        backgroundColor: 'rgba(28,28,25,0.38)',
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
    title: {
        letterSpacing: 1.6,
        paddingHorizontal: 24,
        paddingTop: 10,
        paddingBottom: 4,
    },
    scroll: {
        maxHeight: 380,
    },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 24,
    },
    optionLabel: {
        fontSize: 16,
    },
});
