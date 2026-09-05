/**
 * ListEmojiPicker — pick a single emoji to represent a list (TICKET-108).
 *
 * A curated row of food-adjacent emoji + a "none" chip + an optional 1-grapheme
 * free-entry field. NO third-party emoji-picker dependency. This is the ONE
 * sanctioned exception to the no-emoji-in-chrome rule: a user-chosen list emoji
 * is user content, like a reaction.
 *
 * Shared by /list/new, /list/[id]/edit (via ListEditForm), and CreateListSheet
 * so the picker never drifts across the three creation/edit surfaces.
 *
 * The field LABEL stays Manrope (functional chrome); the emoji glyphs are the
 * only decorative content, and they're user-facing selectable items.
 */
import React, { useState } from 'react';
import { View, Text, Pressable, TextInput, StyleSheet, ScrollView } from 'react-native';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type Palette = typeof Colors.light;

/** Curated food-adjacent set (spec decision 2). */
const CURATED = ['🍜', '🍕', '🍣', '🍷', '☕', '🥐', '🍦', '🌮', '🍔', '🥂', '🍺', '🍰', '🦪', '🍝', '🥟', '⭐'] as const;

interface Props {
    /** Current emoji, or null for "none". */
    value: string | null;
    onChange: (next: string | null) => void;
    palette?: Palette;
    variant?: 'default' | 'compact';
    onPick?: () => void;
}

/** First grapheme of an input string (multi-codepoint safe). */
function firstGrapheme(s: string): string {
    const chars = [...s.trim()];
    return chars.length ? chars[0] : '';
}

export function ListEmojiPicker({ value, onChange, palette: paletteProp, variant = 'default', onPick }: Props) {
    const scheme = useColorScheme();
    const palette = (paletteProp ?? Colors[scheme ?? 'light']) as Palette;

    // Free-entry mirrors `value` when it's a custom (non-curated) glyph.
    const isCustom = value != null && !CURATED.includes(value as (typeof CURATED)[number]);
    const [custom, setCustom] = useState(isCustom ? value! : '');

    const handleCustom = (raw: string) => {
        const g = firstGrapheme(raw);
        setCustom(g);
        onChange(g || null);
    };

    return (
        <View style={styles.wrap}>
            {variant === 'default' ? <Text style={[Type.label, { color: palette.textMuted, marginBottom: Spacing.xs }]}>
                Icon (optional)
            </Text> : null}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={styles.row}
            >
                {/* none */}
                <Pressable
                    onPress={() => { onChange(null); setCustom(''); onPick?.(); }}
                    style={[
                        styles.chip,
                        variant === 'compact' && styles.compactChip,
                        styles.noneChip,
                        {
                            backgroundColor: value == null ? palette.primaryMuted : palette.surfaceJournalHi,
                            borderColor: value == null ? palette.primary : 'transparent',
                        },
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: value == null }}
                    accessibilityLabel="no icon"
                >
                    <Text style={[styles.noneText, { color: value == null ? palette.primary : palette.textMuted }]}>
                        none
                    </Text>
                </Pressable>

                {CURATED.map((e) => {
                    const active = value === e;
                    return (
                        <Pressable
                            key={e}
                            onPress={() => { onChange(e); setCustom(''); onPick?.(); }}
                            style={[
                                styles.chip,
                        variant === 'compact' && styles.compactChip,
                                {
                                    backgroundColor: active ? palette.primaryMuted : palette.surfaceJournalHi,
                                    borderColor: active ? palette.primary : 'transparent',
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityState={{ selected: active }}
                            accessibilityLabel={`icon ${e}`}
                        >
                            <Text style={styles.emoji}>{e}</Text>
                        </Pressable>
                    );
                })}

                {/* free-entry — 1 grapheme */}
                <TextInput
                    value={custom}
                    onChangeText={handleCustom}
                    placeholder="＋"
                    placeholderTextColor={palette.textMuted}
                    style={[
                        styles.chip,
                        variant === 'compact' && styles.compactChip,
                        styles.customInput,
                        {
                            backgroundColor: isCustom ? palette.primaryMuted : palette.surfaceJournalHi,
                            borderColor: isCustom ? palette.primary : 'transparent',
                            color: palette.text,
                        },
                    ]}
                    accessibilityLabel="custom icon"
                    maxLength={4}
                    returnKeyType="done"
                    onSubmitEditing={onPick}
                />
            </ScrollView>
        </View>
    );
}

const CHIP = 44;

const styles = StyleSheet.create({
    wrap: {
        marginBottom: Spacing.lg,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingRight: Spacing.md,
    },
    compactChip: { borderRadius: Radius.full, borderWidth: 0 },
    chip: {
        width: CHIP,
        height: CHIP,
        borderRadius: Radius.md,
        borderWidth: 1.5,
        alignItems: 'center',
        justifyContent: 'center',
    },
    noneChip: {
        width: 'auto',
        paddingHorizontal: 14,
    },
    noneText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 12,
        letterSpacing: 0.3,
    },
    emoji: {
        fontSize: 22,
        lineHeight: 26,
    },
    customInput: {
        fontSize: 22,
        textAlign: 'center',
        padding: 0,
    },
});
