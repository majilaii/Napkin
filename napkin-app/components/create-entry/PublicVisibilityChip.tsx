/**
 * PublicVisibilityChip — inline composer transparency chip.
 *
 * Appears below the note field in create-entry when:
 *   - The user's account is public
 *   - The draft rating is set
 *   - The trimmed note is ≥ 20 chars
 *
 * Informational only — not tappable. Users change privacy in /settings.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

interface PublicVisibilityChipProps {
    isAccountPublic: boolean;
    rating: number | null;
    note: string;
}

export function PublicVisibilityChip({
    isAccountPublic,
    rating,
    note,
}: PublicVisibilityChipProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    // Debounced visibility — 150ms so it doesn't flicker on every keystroke
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        const qualifies =
            isAccountPublic &&
            rating != null &&
            note.trim().length >= 20;

        const t = setTimeout(() => setVisible(qualifies), 150);
        return () => clearTimeout(t);
    }, [isAccountPublic, rating, note]);

    if (!visible) return null;

    return (
        <View style={styles.chip}>
            <Text style={[styles.chipText, { color: palette.textMuted }]}>
                This will appear on the restaurant&apos;s page
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    chip: {
        paddingVertical: 4,
    },
    chipText: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 13,
        lineHeight: 18,
    },
});
