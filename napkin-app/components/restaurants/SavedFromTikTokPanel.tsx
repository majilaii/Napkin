/**
 * SavedFromTikTokPanel — quiet provenance line for a wishlist entry saved via a
 * TikTok video (TICKET-054; redesigned 2026-06-17).
 *
 * Earlier this was a tall 9:16 thumbnail card with a serif headline parked right
 * under the primary CTA — it read as a hero content section ("too tacky / front
 * and center"). It is now a single muted meta line that lives with the other
 * restaurant metadata (phone · directions · website · hours): a small TikTok
 * glyph + lowercase Manrope "saved from tiktok · @handle" in textMuted. The
 * provenance is preserved (and still taps through to the video) — it just no
 * longer competes with the Table voices.
 *
 * Heirloom: lowercase verb, middle-dot metadata separator, Ionicons outline,
 * muted Manrope (no italic serif — that's reserved for brand names/numerals),
 * no card background, no shadow, no thumbnail.
 */
import React from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { WishlistSourceTikTok } from '@/lib/types/wishlistSource';

interface SavedFromTikTokPanelProps {
    source: WishlistSourceTikTok;
}

export function SavedFromTikTokPanel({ source }: SavedFromTikTokPanelProps) {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];

    const handle = source.author_handle ?? source.author_name ?? null;
    const hasUrl = !!source.url;

    const handlePress = async () => {
        if (!source.url) return;
        try {
            await Linking.openURL(source.url);
        } catch (err) {
            console.error('[SavedFromTikTokPanel] Linking.openURL failed', err);
            Alert.alert("Couldn't open this link", 'Try again later.');
        }
    };

    const line = (
        <View style={styles.row}>
            <Ionicons name="logo-tiktok" size={14} color={palette.textMuted} style={styles.glyph} />
            <Text style={[styles.label, { color: palette.textMuted }]} numberOfLines={1}>
                saved from tiktok{handle ? ` · @${handle}` : ''}
            </Text>
        </View>
    );

    if (!hasUrl) {
        return (
            <View
                style={styles.wrap}
                accessible
                accessibilityLabel={handle ? `saved from tiktok by @${handle}` : 'saved from tiktok'}
            >
                {line}
            </View>
        );
    }

    return (
        <Pressable
            onPress={handlePress}
            accessibilityRole="link"
            accessibilityLabel={
                handle ? `saved from tiktok by @${handle}, opens on tiktok` : 'saved from tiktok, opens on tiktok'
            }
            style={({ pressed }) => [styles.wrap, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={8}
        >
            {line}
        </Pressable>
    );
}

const styles = StyleSheet.create({
    wrap: {
        marginHorizontal: 22,
        marginTop: Spacing.xs,
        marginBottom: Spacing.sm,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    glyph: {
        marginTop: 1,
    },
    label: {
        fontFamily: 'Manrope_500Medium',
        fontSize: 13,
        flexShrink: 1,
    },
});
