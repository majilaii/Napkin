/**
 * WishlistEmptyState — first-run Pinned empty (Heirloom redesign).
 *
 * A tilted journal tile + warm copy, then the two ways a spot lands here: import
 * from a link, or search for a spot. Vertically centred (rendered outside the
 * scroll), under the live Pinned/Lists toggle.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Radius, Shadow } from '@/constants/theme';

interface Props {
    palette: typeof Colors.light;
    onImport: () => void;
    onSearch: () => void;
}

export function WishlistEmptyState({ palette, onImport, onSearch }: Props) {
    return (
        <View style={styles.root}>
            <View style={[styles.tile, Shadow.subtle, { backgroundColor: palette.surfaceJournal }]}>
                <Ionicons name="book-outline" size={40} color={palette.primary} />
            </View>

            <Text style={[styles.title, { color: palette.text }]}>Nothing pinned yet</Text>
            <Text style={[styles.copy, { color: palette.textSecondary }]}>
                Save a place from a TikTok, a video, or a friend — it lands here, ready when you are.
            </Text>

            <View style={styles.actions}>
                <Pressable
                    onPress={onImport}
                    style={({ pressed }) => [
                        styles.primaryBtn,
                        { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Import from a link"
                >
                    <Ionicons name="download-outline" size={15} color="#fffdf8" />
                    <Text style={[styles.primaryLabel, { color: '#fffdf8' }]}>Import from a link</Text>
                </Pressable>

                <Pressable
                    onPress={onSearch}
                    style={({ pressed }) => [
                        styles.ghostBtn,
                        { borderColor: palette.terracottaBorder, opacity: pressed ? 0.7 : 1 },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Search for a spot"
                >
                    <Ionicons name="search-outline" size={15} color={palette.primary} />
                    <Text style={[styles.ghostLabel, { color: palette.primary }]}>Search for a spot</Text>
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
    },
    tile: {
        width: 84,
        height: 84,
        borderRadius: Radius.xl,
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ rotate: '-3deg' }],
    },
    title: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 26,
        letterSpacing: -0.4,
        marginTop: 26,
    },
    copy: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 14,
        lineHeight: 21,
        textAlign: 'center',
        marginTop: 10,
        maxWidth: 280,
    },
    actions: {
        marginTop: 28,
        width: '100%',
        maxWidth: 260,
        gap: 10,
    },
    primaryBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 15,
        borderRadius: Radius.full,
    },
    primaryLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
    },
    ghostBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        paddingVertical: 15,
        borderRadius: Radius.full,
        borderWidth: 1,
    },
    ghostLabel: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 13,
        letterSpacing: 0.3,
    },
});
